"""Desktop entry point, including isolated bundled PDF worker dispatch."""
from pathlib import Path
import os
import sys


def data_directory():
    if 'FILECRAFT_DATA_DIR' in os.environ:
        return Path(os.environ['FILECRAFT_DATA_DIR'])
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData/Local'))) / 'FileCraft'
    return Path.home() / 'Library/Application Support/FileCraft'


def confirm_quit(window):
    message = 'Quit now? Unfinished work will stop. Copies already saved will remain available.'
    if sys.platform == 'win32':
        # This callback runs on the GUI thread. Show the owned native dialog
        # directly rather than waiting for a JavaScript callback on that thread.
        from System.Windows.Forms import MessageBox, MessageBoxButtons, MessageBoxIcon, DialogResult
        return MessageBox.Show(window.native, message, 'Files are still being processed',
                               MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) == DialogResult.OK
    import AppKit
    alert = AppKit.NSAlert.alloc().init()
    alert.setMessageText_('Files are still being processed')
    alert.setInformativeText_(message)
    alert.addButtonWithTitle_('Keep working')
    alert.addButtonWithTitle_('Quit')
    return alert.runModal() != AppKit.NSAlertFirstButtonReturn


def show_startup_error(data):
    message = f'Try reopening the app. Details are in {data / "desktop.log"}.'
    if sys.platform == 'win32':
        import ctypes
        message += ('\n\nIf Microsoft Edge WebView2 Runtime is missing, run '
                    'MicrosoftEdgeWebview2Setup.exe in the prerequisites folder, then reopen the app.')
        ctypes.windll.user32.MessageBoxW(None, message, 'FileCraft could not start', 0x10)
    else:
        import subprocess
        subprocess.run(['/usr/bin/osascript', '-e',
                        'on run argv\ndisplay alert "FileCraft could not start" message (item 1 of argv)\nend run',
                        message], timeout=60, check=False)


def dispatch_worker():
    if sys.argv[1:2] != ['--pdf-worker']:
        return False
    # PyInstaller's windowed bootloader sets Python stdout/stderr to None.
    # The child still has pipes; reconnect them for the existing JSON protocol.
    sys.stdout = os.fdopen(os.dup(1), 'w', encoding='utf-8', buffering=1)
    sys.stderr = os.fdopen(os.dup(2), 'w', encoding='utf-8', buffering=1)
    worker = sys.argv[2]
    sys.argv = [worker, *sys.argv[3:]]
    if worker == 'pdf_worker.py':
        from pdf_worker import main
    elif worker == 'pdf_pages_worker.py':
        from pdf_pages_worker import main
    else:
        raise SystemExit('Unknown PDF worker')
    main()
    return True


def main():
    if dispatch_worker():
        return
    import logging
    import threading
    data = data_directory()
    data.mkdir(parents=True, exist_ok=True)
    # Console-free launches retain useful errors without altering the app bundle.
    from logging.handlers import RotatingFileHandler
    logging.basicConfig(handlers=[RotatingFileHandler(data / 'desktop.log', maxBytes=1000000,
                                                      backupCount=2, encoding='utf-8')], level=logging.WARNING)
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(data / 'errors.log', 'a', buffering=1, encoding='utf-8')

    service = None
    try:
        import webview
        from server import LocalServer
        if sys.platform == 'win32':
            # Explicitly use the Windows .NET Framework and modern WebView2.
            # A global Python/.NET configuration must not change this bundle.
            os.environ['PYTHONNET_RUNTIME'] = 'netfx'
        # Stable origin keeps watermark preferences between launches. An occupied
        # port gets a new private service rather than attaching to another app.
        try:
            service = LocalServer(('127.0.0.1', 18765), data / 'Exports', data / 'save-locations.json')
        except OSError:
            service = LocalServer(('127.0.0.1', 0), data / 'Exports', data / 'save-locations.json')
        service.last_save_root = service.last_save_root if service.last_save_root.is_dir() else Path.home()
        window = webview.create_window('FileCraft', service.origin, width=1240, height=900,
                                       min_size=(780, 600), background_color='#F7F8F2', text_select=True)

        def choose_folder(initial):
            selected = window.create_file_dialog(webview.FileDialog.FOLDER, directory=str(initial))
            return Path(selected[0]).resolve() if selected else None

        def confirm_busy_close():
            # Closing callbacks run on Cocoa's main thread. Never wait for a
            # JavaScript evaluation here: its completion needs that same thread.
            with service.lock:
                busy = any(not job['finished'] for job in service.jobs.values())
            busy = busy or service.pdf_lock.locked() or service.picker_lock.locked()
            if busy and not confirm_quit(window):
                return False

        service.folder_picker = choose_folder
        window.events.closing += confirm_busy_close
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()
        options = {}
        if sys.platform == 'win32':
            # Check before start: pywebview otherwise silently falls back to IE,
            # which cannot run this interface. Do not initialize the GUI twice.
            from webview.platforms import winforms
            if winforms.renderer != 'edgechromium':
                raise RuntimeError('Microsoft Edge WebView2 Runtime is required.')
            options = {'gui': 'edgechromium', 'icon': str(Path(__file__).parent / 'FileCraft.ico')}
        webview.start(private_mode=False, storage_path=str(data / 'WebView'), **options)
    except Exception:
        logging.exception('Could not run FileCraft')
        show_startup_error(data)
        raise
    finally:
        if service is not None:
            if 'thread' in locals() and thread.is_alive():
                service.shutdown()
                thread.join(timeout=5)
            service.server_close()


if __name__ == '__main__':
    main()
