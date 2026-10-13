"""Run with the included console Python on the Windows test machine."""
from pathlib import Path
import importlib.metadata
import json
import os
import platform
import sys
import tempfile
import traceback


def main():
    failures = []
    print('FileCraft Windows diagnostics', flush=True)
    print('Platform:', platform.platform(), platform.machine(), flush=True)
    print('Python:', sys.version, sys.executable, flush=True)
    print('App folder:', Path(__file__).parent, flush=True)
    print('Runtime:', (Path(__file__).parent / 'bundled-runtime.json').read_text(encoding='utf-8'), flush=True)

    def check(name, function):
        try:
            result = function()
            print(f'PASS: {name}', result if result is not None else '', flush=True)
        except Exception:
            failures.append(name)
            print(f'FAIL: {name}', flush=True)
            traceback.print_exc(file=sys.stdout)

    from desktop import data_directory
    def storage():
        data = data_directory()
        data.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=data) as stream:
            stream.write(b'FileCraft diagnostic')
        return data
    check('Settings folder is writable', storage)
    for package in ('pywebview', 'pymupdf', 'pypdf', 'pythonnet', 'clr_loader', 'cffi'):
        check(f'Included {package}', lambda package=package: importlib.metadata.version(package))

    from pdf_support import ensure_pdf_support, prepare_pdf_pages, assemble_pdf_pages
    check('Included PDF worker starts', ensure_pdf_support)
    def pdf_roundtrip():
        import pymupdf
        with pymupdf.open() as document:
            page = document.new_page()
            page.insert_text((72, 72), 'FileCraft Windows PDF test')
            source = document.tobytes()
        with tempfile.TemporaryDirectory(prefix='filecraft-diagnostic-') as temporary:
            folder = Path(temporary) / 'input'
            metadata = prepare_pdf_pages(source, 'pdf', folder)
            if len(metadata['pages']) != 1 or not metadata['pages'][0]['thumbnail'].startswith('data:image/jpeg;base64,'):
                raise RuntimeError('PDF preview failed')
            result, _ = assemble_pdf_pages({'test': folder / 'document.pdf'}, [{'source': 'test', 'page': 0}])
            with pymupdf.open(stream=result, filetype='pdf') as document:
                if document.page_count != 1 or 'Windows PDF test' not in document[0].get_text():
                    raise RuntimeError('PDF assembly changed page text')
        return 'Preview, page assembly and searchable text preserved'
    check('PDF preview and export round trip', pdf_roundtrip)
    def renderer():
        os.environ['PYTHONNET_RUNTIME'] = 'netfx'
        from webview.platforms import winforms
        if winforms.renderer != 'edgechromium':
            raise RuntimeError('Install Microsoft Edge WebView2 Runtime from prerequisites/MicrosoftEdgeWebview2Setup.exe')
        return winforms.renderer
    check('Native window dependencies and WebView2', renderer)
    print('RESULT:', 'FAILED: ' + ', '.join(failures) if failures else 'All automatic checks passed; test the app window next.', flush=True)
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
