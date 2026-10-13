"""Page assembly, local API boundaries and preservation checks with real PDFs."""
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from pdf_support import PDF_TOOLS, assemble_pdf_pages, prepare_pdf_pages, preview_pdf_page
from server import LocalServer

sys.path.insert(0, str(PDF_TOOLS))
try:
    import pymupdf as fitz
except ImportError:
    fitz = None


def document_bytes():
    with fitz.open() as doc:
        for number in range(5):
            page = doc.new_page(width=400 if number % 2 == 0 else 650, height=600 if number % 2 == 0 else 400)
            page.insert_text((35,45), f'Original page {number+1}', fontsize=20)
        doc[0].insert_link({'kind':fitz.LINK_GOTO,'from':fitz.Rect(35,55,180,75),'page':4,'to':fitz.Point(35,45)})
        doc[0].insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(35,90,180,110),'uri':'https://example.com'})
        for number in (0,2):
            page=doc[number]; widget=fitz.Widget(); widget.field_name='customer'; widget.field_value=f'Value {number+1}'
            widget.field_type=fitz.PDF_WIDGET_TYPE_TEXT; widget.rect=fitz.Rect(35,130,220,155); page.add_widget(widget)
        return doc.tobytes()


@unittest.skipUnless(fitz, 'Install the app-local PDF helper to run real PDF page checks')
class PdfPagesWorkerTest(unittest.TestCase):
    def test_clear_preview_has_readable_resolution_and_keeps_the_source_unchanged(self):
        import base64
        source=Path(__file__).parent/'fixtures/merge-form-a.pdf'
        original=source.read_bytes()
        result=preview_pdf_page(source,2)
        image=base64.b64decode(result['image'].split(',',1)[1])
        pixmap=fitz.Pixmap(image)
        self.assertEqual((pixmap.width,pixmap.height),(result['width'],result['height']))
        self.assertEqual(max(pixmap.width,pixmap.height),1400)
        self.assertAlmostEqual(pixmap.width/pixmap.height,420/600,places=2)
        self.assertEqual(source.read_bytes(),original)
    def test_mixed_real_form_pdfs_keep_the_canonical_field_tree_and_all_widget_values(self):
        from pypdf import PdfReader
        fixtures=Path(__file__).parent/'fixtures'
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            for key in ('a','b'):prepare_pdf_pages((fixtures/f'merge-form-{key}.pdf').read_bytes(),'pdf',root/key)
            encoded,_=assemble_pdf_pages({key:root/key/'document.pdf' for key in ('a','b')},[{'source':'a','page':4},{'source':'b','page':1},{'source':'a','page':0},{'source':'a','page':2}])
            import io
            reader=PdfReader(io.BytesIO(encoded))
            fields=reader.get_fields()
            self.assertEqual({str(field['/V']) for field in fields.values() if '/V' in field},{'Ricky','Second customer','Selected page'})
            with fitz.open(stream=encoded,filetype='pdf') as document:
                widgets=[widget for page in document for widget in page.widgets()]
                self.assertEqual(len(widgets),3)
                for widget in widgets:self.assertEqual(str(fields[widget.field_name]['/V']),widget.field_value)

    def test_reordered_selected_pages_keep_text_sizes_links_and_independent_editable_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); original=document_bytes()
            info=prepare_pdf_pages(original,'pdf',root/'source')
            self.assertEqual(len(info['pages']),5)
            self.assertTrue(all(page['thumbnail'].startswith('data:image/jpeg;base64,') for page in info['pages']))
            self.assertEqual((root/'source/document.pdf').read_bytes(),original)
            result,info=assemble_pdf_pages({'source':root/'source/document.pdf'},[{'source':'source','page':number} for number in (4,0,2)])
            self.assertEqual(info['pages'],3)
            with fitz.open(stream=result,filetype='pdf') as doc:
                self.assertIn('Original page 5',doc[0].get_text()); self.assertIn('Original page 1',doc[1].get_text()); self.assertIn('Original page 3',doc[2].get_text())
                self.assertEqual(doc[0].rect,fitz.Rect(0,0,400,600))
                links=doc[1].get_links()
                self.assertEqual(next(link['page'] for link in links if link['kind']==fitz.LINK_GOTO),0)
                self.assertEqual(next(link['uri'] for link in links if link['kind']==fitz.LINK_URI),'https://example.com')
                widgets=[widget for page in doc for widget in page.widgets()]
                self.assertEqual([widget.field_value for widget in widgets],['Value 1','Value 3'])
                self.assertEqual(len({widget.field_name for widget in widgets}),2)
            self.assertEqual((root/'source/document.pdf').read_bytes(),original)

    def test_multiple_pdf_sources_and_png_pages_combine_without_cropping_or_transparency_damage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            for name in ('a','b'): prepare_pdf_pages(document_bytes(),'pdf',root/name)
            samples=bytes((255,0,0,255))*50*50+bytes((0,0,0,0))*50*50
            pixmap=fitz.Pixmap(fitz.csRGB,100,50,samples,True)
            prepare_pdf_pages(pixmap.tobytes('png'),'png',root/'image')
            pages=[{'source':'a','page':1},{'source':'b','page':4},{'source':'image','page':0}]
            encoded,_=assemble_pdf_pages({name:root/name/'document.pdf' for name in ('a','b','image')},pages)
            with fitz.open(stream=encoded,filetype='pdf') as doc:
                self.assertEqual(doc.page_count,3)
                self.assertEqual(doc[0].rect,fitz.Rect(0,0,650,400))
                self.assertAlmostEqual(doc[2].rect.width/doc[2].rect.height,2)
                pix=doc[2].get_pixmap(alpha=False)
                self.assertEqual(pix.pixel(pix.width-5,pix.height-5),(255,255,255))

    def test_extract_one_page_omits_links_to_pages_not_in_that_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); prepare_pdf_pages(document_bytes(),'pdf',root/'source')
            encoded,_=assemble_pdf_pages({'a':root/'source/document.pdf'},[{'source':'a','page':0}])
            with fitz.open(stream=encoded,filetype='pdf') as doc:
                self.assertEqual(doc.page_count,1)
                self.assertEqual([link['kind'] for link in doc[0].get_links()],[fitz.LINK_URI])
                self.assertEqual(next(doc[0].widgets()).field_value,'Value 1')

    def test_unreadable_and_locked_pdfs_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            with self.assertRaises(ValueError): prepare_pdf_pages(b'%PDF-1.7 damaged','pdf',root/'bad')
            with fitz.open(stream=document_bytes(),filetype='pdf') as doc:
                encrypted=doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256,owner_pw='owner',user_pw='secret')
            with self.assertRaisesRegex(ValueError,'password-protected'): prepare_pdf_pages(encrypted,'pdf',root/'locked')


@unittest.skipUnless(fitz, 'Install the app-local PDF helper to run local PDF API checks')
class PdfPagesApiTest(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(); self.root=Path(self.temporary.name)
        self.server=LocalServer(('127.0.0.1',0),self.root,self.root/'history.json')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        cache=Path(self.server.pdf_temporary.name)
        self.server.shutdown();self.server.server_close()
        self.assertFalse(cache.exists())
        self.temporary.cleanup()
    def request(self,path,body=b'{}',token=True,origin=None):
        if isinstance(body,dict):body=json.dumps(body).encode()
        headers={}
        if token:headers['X-App-Token']=self.server.token
        if origin:headers['Origin']=origin
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        connection.request('POST',path,body,headers);response=connection.getresponse()
        result=response.status,json.loads(response.read());connection.close();return result
    def source(self):
        code,result=self.request('/api/pdf/source?name=original.pdf',document_bytes());self.assertEqual(code,200);return result['source']
    def job(self):
        code,result=self.request('/api/export/start');self.assertEqual(code,200);return result
    def test_preview_requires_a_trusted_source_and_valid_page_and_does_not_create_exports(self):
        source=self.source()
        with patch('server.preview_pdf_page') as renderer:
            self.assertEqual(self.request('/api/pdf/preview',{'source':source,'page':0},token=False)[0],403)
            self.assertEqual(self.request('/api/pdf/preview',{'source':source,'page':0},origin='https://example.com')[0],403)
            for payload in [{'source':source,'page':True},{'source':source,'page':-1},{'source':source,'page':5},{'source':'/etc/passwd','page':0}]:
                self.assertEqual(self.request('/api/pdf/preview',payload)[0],400)
            renderer.assert_not_called()
        code,result=self.request('/api/pdf/preview',{'source':source,'page':0})
        self.assertEqual(code,200);self.assertTrue(result['image'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(max(result['width'],result['height']),1400)
        self.assertEqual(list(self.root.iterdir()),[])
        self.request('/api/pdf/remove',{'source':source})
        self.assertEqual(self.request('/api/pdf/preview',{'source':source,'page':0})[0],400)
    def test_real_export_is_exclusive_and_temporary_source_removal_prevents_further_exports(self):
        source=self.source();job=self.job();pages={'pages':[{'source':source,'page':4},{'source':source,'page':0}]}
        url=f"/api/pdf/export?job={job['job']}&name=chosen.pdf"
        code,result=self.request(url,pages);self.assertEqual(code,200);self.assertEqual(result['pages'],2)
        output=Path(job['path'])/'chosen.pdf';original_output=output.read_bytes()
        self.assertEqual(result['size'],len(original_output))
        self.assertEqual(self.request(url,pages)[0],400);self.assertEqual(output.read_bytes(),original_output)
        self.assertEqual(self.request('/api/pdf/remove',{'source':source})[0],200)
        self.assertEqual(list(Path(self.server.pdf_temporary.name).iterdir()),[])
        self.assertEqual(self.request(url.replace('chosen.pdf','later.pdf'),pages)[0],400)
        self.assertFalse((Path(job['path'])/'later.pdf').exists())
    def test_untrusted_writes_bad_pages_paths_and_finished_jobs_save_nothing(self):
        with patch('server.prepare_pdf_pages') as helper:
            self.assertEqual(self.request('/api/pdf/source?name=a.pdf',b'%PDF-',token=False)[0],403)
            self.assertEqual(self.request('/api/pdf/source?name=a.pdf',b'%PDF-',origin='https://example.com')[0],403)
            helper.assert_not_called()
        source=self.source();job=self.job()
        for pages in [[],[{'source':source,'page':-1}],[{'source':source,'page':5}],[{'source':source,'page':True}],[{'source':'/etc/passwd','page':0}]]:
            with self.subTest(pages=pages):self.assertEqual(self.request(f"/api/pdf/export?job={job['job']}&name=result.pdf",{'pages':pages})[0],400)
        for name in ['../escape.pdf','C:/escape.pdf','result.jpg']:
            self.assertEqual(self.request(f"/api/pdf/export?job={job['job']}&name={name}",{'pages':[{'source':source,'page':0}]})[0],400)
        self.request('/api/export/finish?job='+job['job'])
        self.assertEqual(self.request(f"/api/pdf/export?job={job['job']}&name=result.pdf",{'pages':[{'source':source,'page':0}]})[0],400)
        self.assertEqual(list(Path(job['path']).iterdir()),[])
    def test_failed_import_cleans_temporary_files_and_cannot_accept_a_fake_image_or_other_extension(self):
        for name,data in [('fake.png',b'not PNG'),('malformed.pdf',b'%PDF-1.7 broken'),('text.txt',b'hello')]:
            self.assertEqual(self.request('/api/pdf/source?name='+name,data)[0],400)
        self.assertEqual(self.server.pdf_sources,{})
        self.assertEqual(list(Path(self.server.pdf_temporary.name).iterdir()),[])
