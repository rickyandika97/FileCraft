"""Real PDF worker checks. Uses the app-local helper installed for PDF support."""
from pathlib import Path
import sys
import tempfile
import unittest
from pdf_support import PDF_TOOLS, shrink_pdf

sys.path.insert(0,str(PDF_TOOLS))
try:
    import pymupdf
except ImportError:
    pymupdf=None


@unittest.skipUnless(pymupdf,'Install the app-local PDF helper to run real PDF checks')
class PdfCompressionTest(unittest.TestCase):
    def document(self):
        document=pymupdf.open()
        page=document.new_page(width=500,height=700)
        page.insert_text((45,60),'Searchable text stays readable',fontsize=16)
        page.insert_link({'kind':pymupdf.LINK_URI,'from':pymupdf.Rect(40,45,320,70),'uri':'https://example.com'})
        widget=pymupdf.Widget()
        widget.field_name='customer'
        widget.field_type=pymupdf.PDF_WIDGET_TYPE_TEXT
        widget.field_value='Ricky'
        widget.rect=pymupdf.Rect(45,100,300,125)
        page.add_widget(widget)
        return document

    def test_already_small_pdf_is_copied_byte_for_byte(self):
        with self.document() as document:
            source=document.tobytes()
        result,info=shrink_pdf(source,3000000)
        self.assertEqual(result,source)
        self.assertTrue(info['copied'])
        self.assertEqual(info['pages'],1)

    def test_cleanup_preserves_pages_text_links_and_interactive_fields(self):
        with self.document() as document:
            source=document.tobytes()+b'\n%'+b'padding '*60000
        result,info=shrink_pdf(source,100000)
        self.assertLess(len(result),100000)
        with pymupdf.open(stream=result,filetype='pdf') as checked:
            self.assertEqual(checked.page_count,1)
            self.assertIn('Searchable text stays readable',checked[0].get_text())
            self.assertEqual(checked[0].get_links()[0]['uri'],'https://example.com')
            fields={w.field_name:w.field_value for w in checked[0].widgets()}
            self.assertEqual(fields,{'customer':'Ricky'})

    def test_damaged_pdf_is_rejected(self):
        with self.assertRaises(ValueError):
            shrink_pdf(b'%PDF-1.7\nnot a document',3000000)

    def test_password_protected_oversized_pdf_is_not_rewritten(self):
        with self.document() as document:
            source=document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,owner_pw='owner',user_pw='password')
        with self.assertRaisesRegex(ValueError,'password-protected'):
            shrink_pdf(source+b'\n%'+b'padding '*60000,100000)

    def test_unreachable_limit_is_reported_without_dropping_pages(self):
        import hashlib
        with pymupdf.open() as document:
            for index in range(50):
                page=document.new_page()
                for row in range(60):
                    text=hashlib.sha512(f'{index}-{row}'.encode()).hexdigest()
                    page.insert_text((40,45+row*10),text,fontsize=7)
            source=document.tobytes()
        with self.assertRaisesRegex(ValueError,'larger limit'):
            shrink_pdf(source,100000)
