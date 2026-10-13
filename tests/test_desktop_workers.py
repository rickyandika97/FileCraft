"""Frozen PDF helpers must dispatch locally without installing dependencies."""
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import pdf_support
import desktop


class DesktopWorkersTest(unittest.TestCase):
    def test_frozen_commands_use_the_bundled_executable_dispatcher(self):
        with patch.object(pdf_support.sys, 'frozen', True, create=True):
            self.assertEqual(pdf_support.worker_command('pdf_pages_worker.py', 'preview', Path('/tmp/input.pdf'), 2),
                             [pdf_support.sys.executable, '--pdf-worker', 'pdf_pages_worker.py', 'preview', '/tmp/input.pdf', '2'])
            with patch.dict(os.environ, {'PYTHONPATH': '/unrelated', 'PYTHONHOME': '/unrelated'}):
                env = pdf_support.worker_environment()
                self.assertNotIn('PYTHONPATH', env)
                self.assertNotIn('PYTHONHOME', env)

    def test_frozen_pdf_failure_never_attempts_pip_or_writes_into_the_bundle(self):
        with patch.object(pdf_support.sys, 'frozen', True, create=True), \
                patch.object(pdf_support, '_ready', False), \
                patch('pdf_support.subprocess.run', return_value=subprocess.CompletedProcess([], 1)) as run, \
                patch('pathlib.Path.mkdir') as mkdir:
            with self.assertRaisesRegex(OSError, 'bundled PDF tools'):
                pdf_support.ensure_pdf_support()
            self.assertEqual(run.call_count, 1)
            mkdir.assert_not_called()

    def test_portable_pdf_failure_never_installs_into_the_read_only_app(self):
        with patch.object(pdf_support.sys, 'frozen', False, create=True), \
                patch.object(pdf_support, '_ready', False), \
                patch('pathlib.Path.is_file', return_value=True), \
                patch('pdf_support.subprocess.run', return_value=subprocess.CompletedProcess([], 1)) as run, \
                patch('pathlib.Path.mkdir') as mkdir:
            with self.assertRaisesRegex(OSError, 'bundled PDF tools'):
                pdf_support.ensure_pdf_support()
            self.assertEqual(run.call_count, 1)
            mkdir.assert_not_called()

    def test_windows_gui_uses_console_interpreter_for_captured_worker_json(self):
        with patch.object(pdf_support.sys, 'platform', 'win32'), \
                patch.object(pdf_support.sys, 'frozen', False, create=True), \
                patch.object(pdf_support.sys, 'executable', '/portable/python/pythonw.exe'):
            command = pdf_support.worker_command('pdf_worker.py', '--check')
            self.assertEqual(command[0], '/portable/python/python.exe')
            self.assertEqual(command[1:], [str(pdf_support.ROOT / 'pdf_worker.py'), '--check'])
            self.assertEqual(pdf_support.subprocess_options(), {'creationflags': 0x08000000})

    def test_windows_pdf_check_hides_console_and_retains_isolated_environment(self):
        with patch.object(pdf_support.sys, 'platform', 'win32'), \
                patch.object(pdf_support.sys, 'frozen', False, create=True), \
                patch.object(pdf_support, '_ready', False), \
                patch('pathlib.Path.is_file', return_value=True), \
                patch.dict(os.environ, {'PYTHONPATH': '/unrelated', 'PYTHONHOME': '/unrelated'}), \
                patch('pdf_support.subprocess.run', return_value=subprocess.CompletedProcess([], 0)) as run:
            pdf_support.ensure_pdf_support()
            self.assertEqual(run.call_args.kwargs['creationflags'], 0x08000000)
            self.assertNotIn('PYTHONPATH', run.call_args.kwargs['env'])
            self.assertNotIn('PYTHONHOME', run.call_args.kwargs['env'])

    def test_windows_settings_use_local_app_data_with_explicit_override(self):
        with patch.object(desktop.sys, 'platform', 'win32'), patch.dict(
                os.environ, {'LOCALAPPDATA': '/Windows/User/AppData/Local'}, clear=True):
            self.assertEqual(desktop.data_directory(), Path('/Windows/User/AppData/Local/FileCraft'))
            os.environ['FILECRAFT_DATA_DIR'] = '/custom/settings'
            self.assertEqual(desktop.data_directory(), Path('/custom/settings'))


if __name__ == '__main__':
    unittest.main()
