"""App-local PDF helper setup and isolated compression. Never installs globally."""
from pathlib import Path
import os
import platform
import subprocess
import sys
import tempfile
import threading
import json
import base64

ROOT = Path(__file__).resolve().parent
PDF_VERSION = '1.28.2'
PDF_ASSEMBLY_VERSION = '6.20.0'
PDF_TOOLS = ROOT / '.pdf-tools' / f'py{sys.version_info.major}{sys.version_info.minor}-{sys.platform}-{platform.machine()}'
_setup_lock = threading.Lock()
_ready = False


def bundled_runtime():
    return getattr(sys, 'frozen', False) or (ROOT / 'bundled-runtime.json').is_file()


def subprocess_options():
    # Portable Windows uses pythonw for the GUI and python.exe for workers so
    # captured JSON has real stdout pipes, without flashing console windows.
    return {'creationflags': 0x08000000} if sys.platform == 'win32' else {}


def worker_command(worker, *arguments):
    if getattr(sys, 'frozen', False):
        # The bundled executable dispatches workers before starting the GUI.
        return [sys.executable, '--pdf-worker', worker, *map(str, arguments)]
    executable = Path(sys.executable)
    if sys.platform == 'win32' and executable.name.lower() == 'pythonw.exe':
        executable = executable.with_name('python.exe')
    return [str(executable), str(ROOT / worker), *map(str, arguments)]


def worker_environment():
    if bundled_runtime():
        # Frozen helpers load bundled modules; never inherit a system Python path.
        return {key: value for key, value in os.environ.items() if key not in ('PYTHONPATH', 'PYTHONHOME')}
    return {**os.environ, 'PYTHONPATH': str(PDF_TOOLS), 'PYTHONNOUSERSITE': '1'}


def ensure_pdf_support():
    global _ready
    with _setup_lock:
        if _ready:
            return
        command = worker_command('pdf_worker.py', '--check')
        try:
            check = subprocess.run(command, env=worker_environment(), capture_output=True, timeout=30, **subprocess_options())
        except subprocess.TimeoutExpired:
            raise OSError('PDF support did not respond. Please try again.') from None
        if check.returncode:
            if bundled_runtime():
                raise OSError('The bundled PDF tools could not start. Reinstall FileCraft and try again.')
            PDF_TOOLS.mkdir(parents=True, exist_ok=True)
            try:
                install = subprocess.run([sys.executable, '-m', 'pip', 'install', '--target', str(PDF_TOOLS),
                                          '--only-binary=:all:', '--upgrade', '--no-cache-dir', '--disable-pip-version-check',
                                          '--index-url', 'https://pypi.org/simple', f'PyMuPDF=={PDF_VERSION}', f'pypdf=={PDF_ASSEMBLY_VERSION}'],
                                         capture_output=True, timeout=300, **subprocess_options())
            except subprocess.TimeoutExpired:
                raise OSError('PDF support setup timed out. Check your internet connection and try again.') from None
            if install.returncode:
                raise OSError('PDF support could not be installed. Connect to the internet and try again. Photo compression still works.')
            try:
                check = subprocess.run(command, env=worker_environment(), capture_output=True, timeout=30, **subprocess_options())
            except subprocess.TimeoutExpired:
                raise OSError('PDF support did not respond. Please try again.') from None
        if check.returncode:
            raise OSError('PDF support is not available for this Python installation. Photo compression still works.')
        _ready = True


def shrink_pdf(data, limit):
    if b'%PDF-' not in data[:1024]:
        raise ValueError('This file is not a readable PDF.')
    if not 100000 <= limit <= 20000000:
        raise ValueError('Choose a PDF size limit from 0.1 to 20 MB.')
    ensure_pdf_support()
    with tempfile.TemporaryDirectory(prefix='filecraft-pdf-') as temporary:
        source = Path(temporary) / 'source.pdf'
        output = Path(temporary) / 'result.pdf'
        source.write_bytes(data)
        try:
            result = subprocess.run(worker_command('pdf_worker.py', source, output, limit),
                                    env=worker_environment(), capture_output=True, text=True, encoding='utf-8', timeout=240,
                                    **subprocess_options())
        except subprocess.TimeoutExpired:
            raise ValueError('This PDF took too long to process. Try a smaller document.') from None
        try:
            metadata = json.loads(result.stdout)
        except (ValueError, TypeError):
            raise ValueError('Could not process this PDF. No copy was saved.') from None
        if result.returncode or metadata.get('error'):
            raise ValueError(metadata.get('error') or 'Could not process this PDF. No copy was saved.')
        encoded = output.read_bytes()
        if not encoded.startswith(b'%PDF-') or len(encoded) >= limit or len(encoded) > len(data):
            raise ValueError('This PDF could not fit the selected limit. Choose a larger limit.')
        return encoded, metadata


def run_pages_worker(*arguments):
    ensure_pdf_support()
    try:
        result = subprocess.run(worker_command('pdf_pages_worker.py', *arguments),
                                env=worker_environment(), capture_output=True, text=True, encoding='utf-8', timeout=240,
                                **subprocess_options())
    except subprocess.TimeoutExpired:
        raise ValueError('This file took too long to process. Try a smaller document.') from None
    try:
        metadata = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise ValueError('Could not process the selected pages. No copy was saved.') from None
    if result.returncode or metadata.get('error'):
        raise ValueError(metadata.get('error') or 'Could not process the selected pages.')
    return metadata


def prepare_pdf_pages(data, kind, folder):
    if kind == 'pdf' and b'%PDF-' not in data[:1024]:
        raise ValueError('This file is not a readable PDF.')
    if kind == 'png' and not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('This file is not a readable PNG.')
    if kind == 'jpg' and not data.startswith(b'\xff\xd8\xff'):
        raise ValueError('This file is not a readable JPG.')
    if kind not in ('pdf', 'png', 'jpg'):
        raise ValueError('Add PDF, PNG or JPG files.')
    folder.mkdir()
    source = folder / ('original.' + kind)
    source.write_bytes(data)
    metadata = run_pages_worker('prepare', source, kind, folder)
    for page in metadata['pages']:
        preview = (folder / f"page-{page['page']}.jpg").read_bytes()
        page['thumbnail'] = 'data:image/jpeg;base64,' + base64.b64encode(preview).decode('ascii')
    # The normalized PDF is all that is needed for later exports.
    source.unlink()
    return metadata


def assemble_pdf_pages(sources, pages):
    with tempfile.TemporaryDirectory(prefix='filecraft-pages-export-') as temporary:
        config = Path(temporary) / 'pages.json'
        output = Path(temporary) / 'result.pdf'
        config.write_text(json.dumps({'sources': {key: str(value) for key, value in sources.items()}, 'pages': pages}))
        metadata = run_pages_worker('assemble', config, output)
        data = output.read_bytes()
        if not data.startswith(b'%PDF-'):
            raise ValueError('Could not create this PDF. No copy was saved.')
        return data, metadata


def preview_pdf_page(source, page):
    with tempfile.TemporaryDirectory(prefix='filecraft-page-preview-') as temporary:
        output = Path(temporary) / 'preview.jpg'
        metadata = run_pages_worker('preview', source, page, output)
        data = output.read_bytes()
        if not data.startswith(b'\xff\xd8\xff'):
            raise ValueError('Could not preview this page.')
        return {'image': 'data:image/jpeg;base64,' + base64.b64encode(data).decode('ascii'), **metadata}
