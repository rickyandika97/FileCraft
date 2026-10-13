"""Integration checks for local exports and protection of source files."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from server import LocalServer, safe_relative_name, choose_save_folder


class ExportsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.history = Path(self.tmp.name) / 'locations.json'
        self.server = LocalServer(('127.0.0.1', 0), self.tmp.name, self.history)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, path, body=b'{}', token=True, origin=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        headers = {'Content-Type': 'application/octet-stream'}
        if token:
            headers['X-App-Token'] = self.server.token
        if origin:
            headers['Origin'] = origin
        connection.request('POST', path, body, headers)
        response = connection.getresponse()
        status, result = response.status, json.loads(response.read())
        connection.close()
        return status, result

    def test_nested_export_and_never_overwrite(self):
        status, job = self.request('/api/export/start')
        self.assertEqual(status, 200)
        url = '/api/export/file?job=' + job['job'] + '&name=products/photo.jpg'
        self.assertEqual(self.request(url, b'\xff\xd8\xffsample')[0], 200)
        self.assertEqual(self.request(url, b'\xff\xd8\xffreplacement')[0], 400)
        self.assertEqual((Path(job['path'])/'products/photo.jpg').read_bytes(), b'\xff\xd8\xffsample')
        status, result = self.request('/api/export/finish?job=' + job['job'])
        self.assertEqual(result['count'], 1)
        self.assertEqual(self.request(url.replace('photo.jpg', 'other.jpg'), b'\xff\xd8\xffsample')[0], 400)

    def test_rejects_traversal_and_invalid_payload(self):
        _, job = self.request('/api/export/start')
        prefix = '/api/export/file?job=' + job['job'] + '&name='
        for name in ['../outside.jpg', '/outside.jpg', 'folder/../../outside.jpg', 'photo.exe']:
            self.assertEqual(self.request(prefix+name, b'\xff\xd8\xffsample')[0], 400)
        self.assertEqual(self.request(prefix+'bad.png', b'not an image')[0], 400)
        self.assertEqual(list(Path(job['path']).rglob('*')), [])

    def test_rejects_untrusted_writes(self):
        self.assertEqual(self.request('/api/export/start', token=False)[0], 403)
        self.assertEqual(self.request('/api/export/start', origin='https://example.com')[0], 403)
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_batches_have_distinct_folders(self):
        _, a = self.request('/api/export/start')
        _, b = self.request('/api/export/start')
        self.assertNotEqual(a['path'], b['path'])
        self.assertRegex(Path(a['path']).name, r'^\d{2}-\d{2}-\d{4}-[A-Z0-9]{4}$')
        self.assertRegex(Path(b['path']).name, r'^\d{2}-\d{2}-\d{4}-[A-Z0-9]{4}$')

    def test_date_first_names_retry_a_random_suffix_collision_without_overwriting(self):
        with patch('server.time.strftime', return_value='12-10-2026'), patch('server.secrets.choice', side_effect=list('AB12AB12ZX34')):
            status, first = self.request('/api/export/start')
            self.assertEqual(status, 200)
            marker = Path(first['path']) / 'original.txt'
            marker.write_text('keep this')
            status, second = self.request('/api/export/start')
            self.assertEqual(status, 200)
        self.assertEqual(Path(first['path']).name, '12-10-2026-AB12')
        self.assertEqual(Path(second['path']).name, '12-10-2026-ZX34')
        self.assertEqual(marker.read_text(), 'keep this')

    def test_new_and_legacy_folder_names_can_be_reopened_after_restart(self):
        for name in ['12-10-2026-AB12', '2026-10-12_17-13-00_21e6']:
            folder = Path(self.tmp.name).resolve() / name
            folder.mkdir()
            with self.subTest(name=name), patch('server.open_export_folder') as opener:
                status, result = self.request('/api/export/reveal?folder=' + name)
                self.assertEqual(status, 200)
                self.assertTrue(result['opened'])
                opener.assert_called_once_with(folder)

    def test_browser_assets_have_explicit_content_types(self):
        for path, content_type in [('/', 'text/html'), ('/app.js', 'text/javascript'),
                                   ('/style.css', 'text/css'), ('/icon.svg', 'image/svg+xml')]:
            with self.subTest(path=path):
                connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
                connection.request('GET', path)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader('Content-Type'), content_type + '; charset=utf-8')
                self.assertTrue(response.read())
                connection.close()

    def test_copies_webp_with_header_validation(self):
        _, job = self.request('/api/export/start')
        url = '/api/export/file?job=' + job['job'] + '&name=photo-smaller.webp'
        self.assertEqual(self.request(url, b'not a webp image')[0], 400)
        data = b'RIFF\x08\x00\x00\x00WEBPtest'
        self.assertEqual(self.request(url, data)[0], 200)
        self.assertEqual((Path(job['path']) / 'photo-smaller.webp').read_bytes(), data)

    def test_pdf_endpoint_saves_measured_pdf_output_and_protects_existing_files(self):
        _,job=self.request('/api/export/start')
        url='/api/export/pdf?job='+job['job']+'&name=docs/report-smaller.pdf&limit=3000000'
        encoded=b'%PDF-1.7\ncompressed test output'
        with patch('server.shrink_pdf',return_value=(encoded,{'pages':2,'copied':False,'size':9999})) as compress:
            status,result=self.request(url,b'%PDF-1.7\nsource'+b'original'*100)
            self.assertEqual(status,200)
            self.assertEqual(result['size'],len(encoded))
            self.assertEqual(result['pages'],2)
            self.assertEqual((Path(job['path'])/'docs/report-smaller.pdf').read_bytes(),encoded)
            self.assertEqual(self.request(url,b'%PDF-1.7\nreplace'+b'original'*100)[0],400)
            self.assertEqual((Path(job['path'])/'docs/report-smaller.pdf').read_bytes(),encoded)
            self.assertEqual(self.request(url,token=False)[0],403)
            self.assertEqual(self.request(url.replace('report-smaller.pdf','../outside.pdf'))[0],400)
            self.assertEqual(self.request('/api/export/file?job='+job['job']+'&name=bad.pdf',encoded)[0],400)
            self.request('/api/export/finish?job='+job['job'])
            count=compress.call_count
            self.assertEqual(self.request(url)[0],400)
            self.assertEqual(compress.call_count,count)

    def test_pdf_compression_failure_saves_no_oversized_file(self):
        _,job=self.request('/api/export/start')
        with patch('server.shrink_pdf',side_effect=ValueError('Choose a larger limit')):
            status,result=self.request('/api/export/pdf?job='+job['job']+'&name=report.pdf&limit=100000',b'%PDF-1.7\nsource')
            self.assertEqual(status,400)
            self.assertIn('larger limit',result['error'])
            self.assertEqual(list(Path(job['path']).iterdir()),[])

    def test_reveal_uses_native_folder_opener_on_each_platform(self):
        _, job = self.request('/api/export/start')
        for platform in ('win32', 'darwin', 'linux'):
            with self.subTest(platform=platform), patch('server.sys.platform', platform), \
                    patch('server.os.startfile', create=True) as startfile, \
                    patch('server.subprocess.run') as run:
                run.return_value.returncode = 0
                status, result = self.request('/api/export/reveal?job=' + job['job'])
                self.assertEqual(status, 200)
                self.assertEqual(result['path'], job['path'])
                if platform == 'win32':
                    startfile.assert_called_once_with(job['path'])
                    run.assert_not_called()
                else:
                    command = ['/usr/bin/open', '-a', 'Finder', job['path']] if platform == 'darwin' else ['xdg-open', job['path']]
                    run.assert_called_once_with(command, capture_output=True, text=True, timeout=15)
                    startfile.assert_not_called()

    def test_reveal_detects_file_manager_failure_and_timeout(self):
        import subprocess
        _, job = self.request('/api/export/start')
        url = '/api/export/reveal?job=' + job['job']
        with patch('server.sys.platform', 'darwin'), patch('server.subprocess.run') as run:
            run.return_value.returncode = 1
            status, result = self.request(url)
            self.assertEqual(status, 500)
            self.assertIn('Could not open the export folder', result['error'])
            self.assertNotIn('opened', result)
            run.side_effect = subprocess.TimeoutExpired('open', 15)
            self.assertEqual(self.request(url)[0], 500)

    def test_folder_reveal_survives_lost_jobs_but_cannot_escape_export_root(self):
        _, job = self.request('/api/export/start')
        self.server.jobs.clear()
        name = Path(job['path']).name
        with patch('server.open_export_folder') as opener:
            status, result = self.request('/api/export/reveal?job=' + job['job'] + '&folder=' + name)
            self.assertEqual(status, 200)
            self.assertTrue(result['opened'])
            opener.assert_called_once_with(Path(job['path']))
            for invalid in ['../outside', '/tmp', '..%2F' + name, name + '/nested']:
                self.assertEqual(self.request('/api/export/reveal?folder=' + invalid)[0], 400)
            self.assertEqual(self.request('/api/export/file?job=' + job['job'] + '&name=extra.jpg', b'\xff\xd8\xfftest')[0], 400)

    def test_reveal_rejects_untrusted_requests_and_reports_open_failure(self):
        _, job = self.request('/api/export/start')
        url = '/api/export/reveal?job=' + job['job']
        with patch('server.sys.platform', 'win32'), patch('server.os.startfile', create=True) as startfile:
            self.assertEqual(self.request(url, token=False)[0], 403)
            self.assertEqual(self.request(url, origin='https://example.com')[0], 403)
            self.assertEqual(self.request('/api/export/reveal?job=unknown')[0], 400)
            startfile.assert_not_called()
            startfile.side_effect = OSError('Folder cannot be opened')
            status, result = self.request(url)
            self.assertEqual(status, 500)
            self.assertIn('Folder cannot be opened', result['error'])

    def test_native_folder_selection_saves_only_in_the_chosen_folder(self):
        with tempfile.TemporaryDirectory() as chosen:
            with patch('server.choose_save_folder', return_value=Path(chosen)) as picker:
                status, selection = self.request('/api/export/choose-folder')
                self.assertEqual(status, 200)
                picker.assert_called_once()
            self.assertEqual(selection['path'], str(Path(chosen).resolve()))
            payload = json.dumps({'destination': selection['destination']}).encode()
            status, job = self.request('/api/export/start', payload)
            self.assertEqual(status, 200)
            self.assertEqual(Path(job['path']).parent, Path(chosen).resolve())
            data = b'\xff\xd8\xffsample'
            self.assertEqual(self.request('/api/export/file?job=' + job['job'] + '&name=photos/photo.jpg', data)[0], 200)
            self.assertEqual((Path(job['path']) / 'photos/photo.jpg').read_bytes(), data)
            self.assertEqual(list(Path(self.tmp.name).glob('??-??-????-????')), [])
            # Registered save locations survive restart, but old jobs cannot accept new uploads.
            recovered = LocalServer(('127.0.0.1', 0), self.tmp.name, self.history)
            try:
                self.assertIn(Path(chosen).resolve(), recovered.save_roots)
                self.assertEqual(recovered.jobs, {})
            finally:
                recovered.server_close()

    def test_cancel_and_untrusted_picker_requests_do_not_create_exports(self):
        with patch('server.choose_save_folder', return_value=None) as picker:
            self.assertEqual(self.request('/api/export/choose-folder', token=False)[0], 403)
            self.assertEqual(self.request('/api/export/choose-folder', origin='https://example.com')[0], 403)
            picker.assert_not_called()
            status, result = self.request('/api/export/choose-folder')
            self.assertEqual(status, 200)
            self.assertTrue(result['cancelled'])
            self.assertEqual(self.server.jobs, {})
            self.assertFalse(self.history.exists())
        for destination in ['unapproved-folder', '../outside', None, {}]:
            if destination is None:
                continue
            self.assertEqual(self.request('/api/export/start', json.dumps({'destination':destination}).encode())[0], 400)
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_only_one_native_picker_can_be_open(self):
        self.server.picker_lock.acquire()
        try:
            with patch('server.choose_save_folder') as picker:
                self.assertEqual(self.request('/api/export/choose-folder')[0], 409)
                picker.assert_not_called()
        finally:
            self.server.picker_lock.release()

    def test_reopen_custom_folder_after_restart_rejects_unapproved_paths(self):
        with tempfile.TemporaryDirectory() as chosen, tempfile.TemporaryDirectory() as other:
            folder = Path(chosen) / '2026-10-12_17-13-00_1234'
            folder.mkdir()
            self.server.register_destination(Path(chosen))
            query = '/api/export/reveal?folder=' + folder.name + '&path='
            from urllib.parse import quote
            with patch('server.open_export_folder') as opener:
                self.assertEqual(self.request(query + quote(str(folder)))[0], 200)
                opener.assert_called_once_with(folder)
                self.assertEqual(self.request(query + quote(str(Path(other) / folder.name)))[0], 400)


class NativePickerTest(unittest.TestCase):
    def test_mac_and_windows_picker_output_and_cancellation(self):
        import base64
        with tempfile.TemporaryDirectory() as folder:
            for platform in ('darwin','win32'):
                with self.subTest(platform=platform), patch('server.sys.platform', platform), patch('server.subprocess.run') as run:
                    run.return_value.returncode = 0
                    run.return_value.stdout = folder + '\n'
                    self.assertEqual(choose_save_folder(Path(folder)), Path(folder).resolve())
                    command = run.call_args.args[0]
                    if platform == 'darwin':
                        self.assertEqual(command[0], '/usr/bin/osascript')
                        self.assertIn('choose folder', command[2])
                        self.assertEqual(command[-1], folder)
                    else:
                        self.assertEqual(command[0], 'powershell.exe')
                        self.assertIn('-STA', command)
                        script = base64.b64decode(command[-1]).decode('utf-16-le')
                        self.assertIn('FolderBrowserDialog', script)
                        self.assertEqual(run.call_args.kwargs['env']['FILECRAFT_SAVE_FOLDER'], folder)
                        self.assertNotIn('-ExecutionPolicy', command)
                    run.return_value.stdout = '\n'
                    self.assertIsNone(choose_save_folder(Path(folder)))

    def test_picker_failure_and_timeout(self):
        import subprocess
        with patch('server.sys.platform','darwin'), patch('server.subprocess.run') as run:
            run.return_value.returncode = 1
            with self.assertRaises(OSError):
                choose_save_folder(Path('/tmp'))
            run.side_effect = subprocess.TimeoutExpired('picker',600)
            with self.assertRaises(OSError):
                choose_save_folder(Path('/tmp'))


class PortablePathsTest(unittest.TestCase):
    def test_rejects_windows_drive_and_device_paths_on_every_platform(self):
        for name in ['C:/outside.jpg', 'C:outside.jpg', '//server/share/photo.jpg',
                     'photo.jpg:stream.jpg', 'CON/photo.jpg', 'nul.png', 'Com1/photo.jpg',
                     'LPT²/photo.jpg', 'CON .data/photo.jpg', 'CONOUT$/photo.jpg',
                     'folder./photo.jpg', 'folder /photo.jpg', 'bad?/photo.jpg', 'bad|photo.jpg']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                safe_relative_name(name)

    def test_preserves_valid_nested_names_with_spaces_and_unicode(self):
        self.assertEqual(safe_relative_name('Produk café/Photo 01.jpg'), Path('Produk café', 'Photo 01.jpg'))


if __name__ == '__main__':
    unittest.main()
