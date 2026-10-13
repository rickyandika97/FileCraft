#!/usr/bin/env python3
"""Local-only launcher and export service. Uses the Python standard library."""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
from pathlib import Path, PurePosixPath
import secrets
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import urlopen
import webbrowser
import tempfile
import shutil
from pdf_support import shrink_pdf, prepare_pdf_pages, assemble_pdf_pages, preview_pdf_page

ROOT = Path(__file__).resolve().parent
APP = ROOT / "app"
MAX_FILE_BYTES = 100 * 1024 * 1024
BATCH_SUFFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
WINDOWS_RESERVED = {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'} | {
    prefix + digit for prefix in ('COM', 'LPT') for digit in '123456789¹²³'
}


def safe_relative_name(name: str) -> Path:
    """Accept nested photo names, while keeping every export inside its job."""
    parts = PurePosixPath(name).parts
    if not parts or name.startswith("/") or "\\" in name:
        raise ValueError("Invalid export filename")
    if any(p in (".", "..") or p.endswith((' ', '.'))
           or p.split('.')[0].rstrip(' ').upper() in WINDOWS_RESERVED
           or any(ord(c) < 32 or c in '<>:"\\|?*' for c in p) for p in parts):
        raise ValueError("Invalid export filename")
    if Path(parts[-1]).suffix.lower() not in (".jpg", ".png", ".webp", ".pdf"):
        raise ValueError("Export must be a JPG, PNG, WEBP or PDF")
    return Path(*parts)


def create_batch_folder(root):
    root.mkdir(parents=True, exist_ok=True)
    date = time.strftime('%d-%m-%Y')
    for _ in range(32):
        suffix = ''.join(secrets.choice(BATCH_SUFFIX_CHARS) for _ in range(4))
        folder = root / f'{date}-{suffix}'
        try:
            folder.mkdir(exist_ok=False)
            return folder
        except FileExistsError:
            continue
    raise OSError('Could not create a unique batch folder. Please try again.')


def open_export_folder(folder):
    if not folder.is_dir():
        raise OSError('The export folder no longer exists.')
    if sys.platform == 'win32':
        os.startfile(str(folder))
    else:
        command = ['/usr/bin/open', '-a', 'Finder', str(folder)] if sys.platform == 'darwin' else ['xdg-open', str(folder)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=15)
        except subprocess.TimeoutExpired:
            raise OSError('The file manager did not respond. Your exported photos are still saved.') from None
        if result.returncode:
            raise OSError('The file manager could not open the folder. Your exported photos are still saved.')


def choose_save_folder(initial):
    if sys.platform == 'darwin':
        script = '''on run argv
activate
try
set chosenFolder to choose folder with prompt "Choose where to save your files" default location (POSIX file (item 1 of argv))
return POSIX path of chosenFolder
on error number -128
return ""
end try
end run'''
        command = ['/usr/bin/osascript', '-e', script, str(initial)]
        options = {}
    elif sys.platform == 'win32':
        script = '''$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = 'Choose where to save your files'
$picker.ShowNewFolderButton = $true
$picker.SelectedPath = $env:FILECRAFT_SAVE_FOLDER
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Width = 1
$owner.Height = 1
$owner.Opacity = 0
$owner.Show()
try {
if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.SelectedPath) }
} finally { $picker.Dispose(); $owner.Dispose() }'''
        encoded = base64.b64encode(script.encode('utf-16-le')).decode('ascii')
        command = ['powershell.exe', '-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded]
        options = {'env': {**os.environ, 'FILECRAFT_SAVE_FOLDER': str(initial)}, 'creationflags': 0x08000000}
    else:
        raise OSError('The save folder picker is available on Mac and Windows.')
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=600, **options)
    except subprocess.TimeoutExpired:
        raise OSError('Folder selection timed out. Please try again.') from None
    if result.returncode:
        raise OSError('Could not show the folder picker. Please try again.')
    selected = result.stdout.rstrip('\r\n')
    if not selected:
        return None
    folder = Path(selected).resolve()
    if not folder.is_dir():
        raise OSError('The selected folder is no longer available.')
    return folder


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, export_root=None, history_file=None):
        super().__init__(address, Handler)
        self.token = secrets.token_urlsafe(32)
        self.export_root = Path(export_root or ROOT / "Exports").resolve()
        self.jobs = {}
        self.lock = threading.Lock()
        self.picker_lock = threading.Lock()
        self.folder_picker = None
        self.pdf_lock = threading.Lock()
        self.pdf_temporary = tempfile.TemporaryDirectory(prefix='filecraft-pages-')
        self.pdf_sources = {}
        self.destinations = {}
        self.history_file = Path(history_file or ROOT / '.filecraft-save-locations.json')
        self.save_roots = [self.export_root]
        self.last_save_root = self.export_root if self.export_root.is_dir() else ROOT
        try:
            history = json.loads(self.history_file.read_text(encoding='utf-8'))
            for value in history.get('folders', [])[-128:]:
                if isinstance(value, str) and Path(value).is_absolute():
                    folder = Path(value).resolve()
                    if folder not in self.save_roots:
                        self.save_roots.append(folder)
            previous = Path(history.get('last', ''))
            if previous in self.save_roots and previous.is_dir():
                self.last_save_root = previous
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def register_destination(self, folder):
        folder = Path(folder).resolve()
        destination = secrets.token_urlsafe(24)
        with self.lock:
            self.destinations[destination] = folder
            if folder in self.save_roots:
                self.save_roots.remove(folder)
            self.save_roots.append(folder)
            self.last_save_root = folder
            temporary = self.history_file.with_name(self.history_file.name + '.tmp')
            try:
                temporary.write_text(json.dumps({'folders': [str(root) for root in self.save_roots[-128:]], 'last': str(folder)}, ensure_ascii=False), encoding='utf-8')
                temporary.replace(self.history_file)
            except OSError:
                # Saving photos still works if the app folder cannot retain location history.
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
        return destination

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server_port}"

    def server_close(self):
        super().server_close()
        self.pdf_temporary.cleanup()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args) > 1 else "").startswith("5"):
            super().log_message(fmt, *args)

    def reply(self, code, body, content_type="application/json"):
        data = json.dumps(body).encode() if content_type == "application/json" else body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(data)

    def trusted(self, mutation=False):
        if self.headers.get("Host") != urlsplit(self.server.origin).netloc:
            self.reply(403, {"error": "Use the local application address"})
            return False
        origin = self.headers.get("Origin")
        if (origin and origin != self.server.origin) or self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.reply(403, {"error": "Only the local application can access this service"})
            return False
        if mutation and not secrets.compare_digest(self.headers.get("X-App-Token", ""), self.server.token):
            self.reply(403, {"error": "Reload the application and try again"})
            return False
        return True

    def do_GET(self):
        if not self.trusted():
            return
        path = urlsplit(self.path).path
        if path == "/api/session":
            self.reply(200, {"app": "filecraft", "token": self.server.token, "exportRoot": str(self.server.export_root)})
            return
        # Use fixed types so Windows registry associations cannot prevent scripts/styles loading.
        assets = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                  "/style.css": ("style.css", "text/css"), "/icon.svg": ("icon.svg", "image/svg+xml")}
        if path not in assets:
            self.reply(404, {"error": "Not found"})
            return
        filename, content_type = assets[path]
        self.reply(200, (APP / filename).read_bytes(), content_type + "; charset=utf-8")

    def read_body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= MAX_FILE_BYTES:
            raise ValueError("Invalid file size (maximum 100 MB per file)")
        data = self.rfile.read(size)
        if len(data) != size:
            raise ValueError("Incomplete upload")
        return data

    def do_POST(self):
        if not self.trusted(mutation=True):
            return
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path == '/api/pdf/preview':
                payload = json.loads(self.read_body())
                if not isinstance(payload, dict) or not isinstance(payload.get('source'), str) or type(payload.get('page')) is not int:
                    raise ValueError('Invalid page preview.')
                with self.server.pdf_lock:
                    source = self.server.pdf_sources.get(payload['source'])
                    if not source:
                        raise ValueError('The PDF workspace expired. Clear it and add your files again.')
                    if not 0 <= payload['page'] < source['pages']:
                        raise ValueError('Invalid page number.')
                    result = preview_pdf_page(source['path'], payload['page'])
                self.reply(200, result)
            elif parsed.path == '/api/pdf/source':
                kind = Path(query.get('name', [''])[0]).suffix.lower().lstrip('.')
                if kind == 'jpeg':
                    kind = 'jpg'
                data = self.read_body()
                with self.server.pdf_lock:
                    if len(self.server.pdf_sources) >= 50:
                        raise ValueError('Clear the PDF workspace before adding more files (50 files maximum).')
                    source = secrets.token_urlsafe(24)
                    folder = Path(self.server.pdf_temporary.name) / source
                    try:
                        metadata = prepare_pdf_pages(data, kind, folder)
                        disk_size = sum(item.stat().st_size for item in folder.iterdir())
                        if sum(item['size'] for item in self.server.pdf_sources.values()) + disk_size > 500000000:
                            raise ValueError('The PDF workspace is full (500 MB maximum). Clear it before adding more files.')
                        if sum(item['pages'] for item in self.server.pdf_sources.values()) + len(metadata['pages']) > 1000:
                            raise ValueError('The PDF workspace holds up to 1000 pages. Clear it before adding more files.')
                        self.server.pdf_sources[source] = {'path': folder / 'document.pdf', 'pages': len(metadata['pages']), 'size': disk_size}
                    except Exception:
                        shutil.rmtree(folder, ignore_errors=True)
                        raise
                self.reply(200, {'source': source, **metadata})
            elif parsed.path == '/api/pdf/remove':
                payload = json.loads(self.read_body())
                if not isinstance(payload, dict) or not isinstance(payload.get('source'), str):
                    raise ValueError('Invalid PDF source.')
                with self.server.pdf_lock:
                    source = self.server.pdf_sources.pop(payload['source'], None)
                    if source:
                        shutil.rmtree(source['path'].parent)
                self.reply(200, {'removed': True})
            elif parsed.path == '/api/pdf/export':
                job = self.get_job(query)
                name = safe_relative_name(query.get('name', [''])[0])
                if name.suffix.lower() != '.pdf':
                    raise ValueError('Choose a .pdf output filename.')
                payload = json.loads(self.read_body())
                pages = payload.get('pages') if isinstance(payload, dict) else None
                if not isinstance(pages, list) or not 0 < len(pages) <= 1000:
                    raise ValueError('Choose from 1 to 1000 pages to save.')
                with self.server.lock:
                    if job['finished']:
                        raise ValueError('This export is already finished')
                with self.server.pdf_lock:
                    sources = {}
                    for page in pages:
                        if not isinstance(page, dict) or not isinstance(page.get('source'), str) or type(page.get('page')) is not int:
                            raise ValueError('Invalid page selection.')
                        source = self.server.pdf_sources.get(page['source'])
                        if not source:
                            raise ValueError('The PDF workspace expired. Clear it and add your files again.')
                        if not 0 <= page['page'] < source['pages']:
                            raise ValueError('Invalid page number.')
                        sources[page['source']] = source['path']
                    encoded, metadata = assemble_pdf_pages(sources, pages)
                    if not encoded.startswith(b'%PDF-') or metadata.get('pages') != len(pages):
                        raise ValueError('Could not create the selected PDF pages. No copy was saved.')
                with self.server.lock:
                    if job['finished']:
                        raise ValueError('This export is already finished')
                    destination = job['path'] / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        with destination.open('xb') as stream:
                            stream.write(encoded)
                    except FileExistsError:
                        raise ValueError('That filename has already been exported') from None
                    except OSError:
                        destination.unlink(missing_ok=True)
                        raise
                    job['count'] += 1
                self.reply(200, {'saved': True, **metadata, 'size': len(encoded)})
            elif parsed.path == '/api/export/choose-folder':
                self.read_body()
                if not self.server.picker_lock.acquire(blocking=False):
                    self.reply(409, {'error': 'A save folder is already being chosen.'})
                    return
                try:
                    initial = self.server.last_save_root
                    folder = (self.server.folder_picker or choose_save_folder)(initial if initial.is_dir() else ROOT)
                    if folder is None:
                        self.reply(200, {'cancelled': True})
                    else:
                        folder = Path(folder).resolve()
                        destination = self.server.register_destination(folder)
                        self.reply(200, {'destination': destination, 'path': str(folder), 'cancelled': False})
                finally:
                    self.server.picker_lock.release()
            elif parsed.path == "/api/export/start":
                payload = json.loads(self.read_body())
                if not isinstance(payload, dict):
                    raise ValueError('Invalid export settings')
                destination = payload.get('destination')
                if destination is not None:
                    if not isinstance(destination, str) or destination not in self.server.destinations:
                        raise ValueError('Choose a save folder again.')
                    root = self.server.destinations[destination]
                    if not root.is_dir():
                        raise OSError('The save folder is no longer available. Choose another folder.')
                else:
                    root = self.server.export_root
                job = secrets.token_hex(8)
                folder = create_batch_folder(root)
                with self.server.lock:
                    self.server.jobs[job] = {"path": folder, "finished": False, "count": 0}
                self.reply(200, {"job": job, "path": str(folder)})
            elif parsed.path == '/api/export/pdf':
                job = self.get_job(query)
                name = safe_relative_name(query.get('name', [''])[0])
                if name.suffix.lower() != '.pdf':
                    raise ValueError('PDF output must have a .pdf filename')
                limit = int(query.get('limit', ['0'])[0])
                data = self.read_body()
                with self.server.lock:
                    if job['finished']:
                        raise ValueError('This export is already finished')
                encoded, metadata = shrink_pdf(data, limit)
                if not encoded.startswith(b'%PDF-') or len(encoded) >= limit or len(encoded) > len(data):
                    raise ValueError('This PDF could not fit the selected limit. No oversized copy was saved.')
                with self.server.lock:
                    if job['finished']:
                        raise ValueError('This export is already finished')
                    destination = job['path'] / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        with destination.open('xb') as stream:
                            stream.write(encoded)
                    except FileExistsError:
                        raise ValueError('That filename has already been exported') from None
                    except OSError:
                        destination.unlink(missing_ok=True)
                        raise
                    job['count'] += 1
                self.reply(200, {'saved': True, 'format': 'pdf', **metadata, 'size': len(encoded)})
            elif parsed.path == "/api/export/file":
                job = self.get_job(query)
                name = safe_relative_name(query.get("name", [""])[0])
                data = self.read_body()
                if name.suffix == ".jpg" and not data.startswith(b"\xff\xd8\xff"):
                    raise ValueError("Invalid JPG data")
                if name.suffix == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("Invalid PNG data")
                if name.suffix == ".webp" and not (data.startswith(b'RIFF') and data[8:12] == b'WEBP'):
                    raise ValueError("Invalid WEBP data")
                if name.suffix.lower() == '.pdf':
                    raise ValueError('Use the PDF compression request to save PDFs.')
                with self.server.lock:
                    if job["finished"]:
                        raise ValueError("This export is already finished")
                    destination = job["path"] / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    # Exclusive creation: never replace an existing photo.
                    try:
                        with destination.open("xb") as stream:
                            stream.write(data)
                    except FileExistsError:
                        raise ValueError("That filename has already been exported")
                    except OSError:
                        destination.unlink(missing_ok=True)
                        raise
                    job["count"] += 1
                self.reply(200, {"saved": True})
            elif parsed.path == "/api/export/finish":
                self.read_body()
                job = self.get_job(query)
                with self.server.lock:
                    job["finished"] = True
                self.reply(200, {"path": str(job["path"]), "count": job["count"]})
            elif parsed.path == "/api/export/reveal":
                self.read_body()
                folder = self.get_reveal_folder(query)
                open_export_folder(folder)
                self.reply(200, {"path": str(folder), "opened": True})
            else:
                self.reply(404, {"error": "Not found"})
        except (ValueError, KeyError) as error:
            self.reply(400, {"error": str(error)})
        except OSError as error:
            action = 'Could not open the export folder: ' if parsed.path == '/api/export/reveal' else 'Could not choose a save folder: ' if parsed.path == '/api/export/choose-folder' else 'Could not save the export: '
            self.reply(500, {"error": action + str(error)})

    def get_reveal_folder(self, query):
        key = query.get('job', [''])[0]
        with self.server.lock:
            if key in self.server.jobs:
                return self.server.jobs[key]['path']
        # Folder links can survive a service restart without restoring writable export jobs.
        name = query.get('folder', [''])[0]
        if not re.fullmatch(r'(?:\d{2}-\d{2}-\d{4}-[A-Z0-9]{4}|\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[0-9a-f]{4})', name):
            raise ValueError('Unknown export folder')
        supplied = query.get('path', [''])[0]
        folder = Path(supplied) if supplied else self.server.export_root / name
        if folder.name != name or not folder.is_absolute() or folder.is_symlink() or folder.resolve().parent not in self.server.save_roots:
            raise ValueError('Invalid export folder')
        return folder

    def get_job(self, query):
        key = query.get("job", [""])[0]
        with self.server.lock:
            if key not in self.server.jobs:
                raise ValueError("Unknown export session")
            return self.server.jobs[key]


def main():
    parser = argparse.ArgumentParser(description="FileCraft — local photo and PDF toolkit")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--export-root", type=Path)
    args = parser.parse_args()
    try:
        server = LocalServer(("127.0.0.1", args.port), args.export_root)
    except OSError as error:
        existing_url = f"http://127.0.0.1:{args.port}"
        try:
            with urlopen(existing_url + "/api/session", timeout=2) as response:
                existing = json.load(response)
            if existing.get("app") == "filecraft" and existing.get("exportRoot") == str(Path(args.export_root or ROOT / "Exports").resolve()):
                print(f"FileCraft is already running at {existing_url}")
                if not args.no_browser:
                    webbrowser.open(existing_url)
                return
        except Exception:
            pass
        parser.error(f"Could not start the local service: {error}. Try --port 8766, or close the already running tool.")
    print(f"\nFileCraft is running at {server.origin}", flush=True)
    print(f"Exports: {server.export_root}\nKeep this window open. Press Control+C to stop.\n", flush=True)
    if not args.no_browser:
        webbrowser.open(server.origin)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
