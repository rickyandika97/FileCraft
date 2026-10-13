"""Assemble a portable Windows x64 desktop app from Mac, Linux or Windows."""
from pathlib import Path
from email.parser import BytesParser
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile

from build_mac import VERSION
from brand_icon import render_icon

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build/windows'
NAME = 'FileCraft'


def run(*command, **kwargs):
    subprocess.run(command, cwd=ROOT, check=True, **kwargs)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def downloads():
    lock = json.loads((ROOT / 'packaging/windows-downloads.lock.json').read_text())
    folder = BUILD / 'downloads'
    folder.mkdir(parents=True, exist_ok=True)
    for entry in lock['artifacts']:
        path = folder / entry['filename']
        if not path.is_file() or digest(path) != entry['sha256']:
            temporary = path.with_suffix(path.suffix + '.partial')
            run('curl', '--fail', '--location', '--retry', '2', '--max-time', '300',
                '--output', str(temporary), entry['url'])
            if digest(temporary) != entry['sha256']:
                temporary.unlink()
                raise RuntimeError(f'Upstream download changed: {entry["filename"]}. Review the lock before rebuilding.')
            temporary.replace(path)
        print(f'Verified {path.name}', flush=True)
    return lock


def make_icon(app):
    image = render_icon()
    icon = app / 'FileCraft.ico'
    image.save(icon, sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
    return icon


def compile_launcher(stage, icon, zig):
    resource = BUILD / 'FileCraft.rc'
    manifest = BUILD / 'FileCraft.manifest'
    manifest.write_text('''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.3.0" processorArchitecture="amd64" name="FileCraft" type="win32"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>
    <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
  </requestedPrivileges></security></trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>
    <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
  </application></compatibility>
</assembly>
''', encoding='utf-8')
    resource.write_text(f'''1 ICON "{icon.as_posix()}"
1 24 "{manifest.as_posix()}"
1 VERSIONINFO
FILEVERSION 1,0,3,0
PRODUCTVERSION 1,0,3,0
FILEOS 0x40004
FILETYPE 1
BEGIN
 BLOCK "StringFileInfo"
 BEGIN
  BLOCK "040904B0"
  BEGIN
   VALUE "FileDescription", "FileCraft desktop launcher\\0"
   VALUE "FileVersion", "{VERSION}\\0"
   VALUE "ProductName", "FileCraft\\0"
   VALUE "ProductVersion", "{VERSION}\\0"
   VALUE "LegalCopyright", "GNU AGPLv3; see LICENSE\\0"
  END
 END
 BLOCK "VarFileInfo"
 BEGIN
  VALUE "Translation", 0x409, 1200
 END
END
''', encoding='utf-8')
    env = {**os.environ, 'ZIG_GLOBAL_CACHE_DIR': str(BUILD / 'zig-global-cache'),
           'ZIG_LOCAL_CACHE_DIR': str(BUILD / 'zig-cache')}
    obj = BUILD / 'FileCraft-resource.obj'
    run(zig, 'rc', '/:no-preprocess', '/:target', 'x64', '/fo', str(obj), '--', str(resource), env=env)
    run(zig, 'cc', '-target', 'x86_64-windows-gnu', '-Os', '-municode', '-Wl,--subsystem,windows',
        str(ROOT / 'packaging/windows-launcher.c'), str(obj), '-o', str(stage / (NAME + '.exe')),
        '-luser32', '-lkernel32', env=env)


def install_wheels(lock, python):
    target = python / 'Lib/site-packages'
    target.mkdir(parents=True)
    notices = []
    for entry in lock['artifacts']:
        if entry['kind'] not in ('wheel', 'sdist'):
            continue
        path = BUILD / 'downloads' / entry['filename']
        if entry['kind'] == 'sdist':
            wheels = BUILD / 'source-wheels'
            wheels.mkdir(exist_ok=True)
            run(sys.executable, '-m', 'pip', 'wheel', '--no-deps', '--no-build-isolation',
                '--wheel-dir', str(wheels), str(path))
            path = wheels / 'proxy_tools-0.1.0-py3-none-any.whl'
        with zipfile.ZipFile(path) as archive:
            metadata = BytesParser().parsebytes(archive.read(next(
                n for n in archive.namelist() if n.endswith('.dist-info/METADATA'))))
            notices.append(f'\n===== {metadata["Name"]} {metadata["Version"]} =====')
            for key in ('License', 'Home-page', 'Project-URL'):
                notices.extend(metadata.get_all(key, []))
            for name in archive.namelist():
                parts = Path(name).parts
                if Path(name).is_absolute() or '..' in parts:
                    raise RuntimeError('Unsafe wheel path')
                if any(part.endswith('.data') for part in parts):
                    # bottle ships an optional command-line script; the app only
                    # uses its top-level module. Do not install script wrappers.
                    if len(parts) >= 2 and parts[1] == 'scripts':
                        continue
                    raise RuntimeError(f'Wheel data relocation needs review: {path.name}')
                archive.extract(name, target)
                if Path(name).name.lower().startswith(('license', 'copying', 'notice')):
                    notices.append(archive.read(name).decode('utf-8', errors='replace'))
    return notices


def archive_folder(folder, output):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(folder.rglob('*')):
            if path.is_file():
                archive.write(path, Path(folder.name) / path.relative_to(folder))
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError(f'Archive verification failed: {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zig', default=str(BUILD / 'toolchain/ziglang/zig'), help='Path to Zig 0.14.1')
    args = parser.parse_args()
    lock = downloads()
    stage = ROOT / 'dist/windows-x64' / NAME
    if stage.exists():
        shutil.rmtree(stage)
    python = stage / '_internal/python'
    app = stage / '_internal/app'
    python.mkdir(parents=True)
    app.mkdir(parents=True)
    embedded = next(e for e in lock['artifacts'] if e['kind'] == 'python')
    with zipfile.ZipFile(BUILD / 'downloads' / embedded['filename']) as archive:
        archive.extractall(python)
    # The official isolated runtime ignores user Python installations and paths.
    (python / 'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../app\nimport site\n')
    notices = install_wheels(lock, python)
    for name in ('desktop.py', 'server.py', 'pdf_support.py', 'pdf_worker.py', 'pdf_pages_worker.py'):
        shutil.copy2(ROOT / name, app)
    shutil.copy2(ROOT / 'packaging/windows_diagnostics.py', app)
    shutil.copytree(ROOT / 'app', app / 'app')
    html = app / 'app/index.html'
    html.write_text(html.read_text(encoding='utf-8').replace(
        'First-time PDF setup needs internet; your files stay on this computer.',
        'PDF tools are included; your files stay on this computer.').replace(
        'First-time PDF setup needs an internet connection; your files stay on this computer.',
        'PDF tools are included and work offline; your files stay on this computer.'), encoding='utf-8')
    (app / 'bundled-runtime.json').write_text(json.dumps({
        'app_name': NAME, 'app_version': VERSION, 'python': lock['python'], 'architecture': 'x64',
        'pdf_tools': 'included', 'windows_device_test': 'pending'}, indent=2) + '\n')
    icon = make_icon(app)
    compile_launcher(stage, icon, args.zig)
    prerequisites = stage / 'prerequisites'
    prerequisites.mkdir()
    for entry in lock['artifacts']:
        if entry['kind'] == 'prerequisite':
            shutil.copy2(BUILD / 'downloads' / entry['filename'], prerequisites)
    (stage / 'Diagnose Windows.bat').write_text(
        '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\n'
        'if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\\AppData\\Local"\r\n'
        'set "REPORT=%LOCALAPPDATA%\\FileCraft\\windows-diagnostics.txt"\r\n'
        'if not exist "%LOCALAPPDATA%\\FileCraft" mkdir "%LOCALAPPDATA%\\FileCraft"\r\n'
        '"%~dp0_internal\\python\\python.exe" -X utf8 -B "%~dp0_internal\\app\\windows_diagnostics.py" > "%REPORT%" 2>&1\r\n'
        'type "%REPORT%"\r\necho.\r\necho Report saved to "%REPORT%"\r\npause\r\n',
        encoding='utf-8', newline='')
    shutil.copy2(ROOT / 'docs/TESTING_WINDOWS.md', stage / 'START HERE.txt')
    shutil.copy2(ROOT / 'LICENSE', stage)
    text = (f'FileCraft {VERSION} Windows x64 — third-party notices\n'
            f'Includes CPython {lock["python"]} and the packages listed below.\n'
            'FileCraft is licensed under GNU AGPL version 3.\n'
            'Microsoft installers in prerequisites retain their Microsoft license terms.\n'
            'WebView2 Runtime and .NET Framework are Windows prerequisites, not bundled runtimes.\n'
            'Download URLs and SHA256 hashes: WINDOWS-DOWNLOADS.json.\n'
            'App source and build scripts are in the matching windows-x64-source.zip.\n\n'
            '===== Python =====\n' + (python / 'LICENSE.txt').read_text(encoding='utf-8') +
            '\n'.join(notices) + '\n===== GNU AGPL version 3 =====\n' + (ROOT / 'LICENSE').read_text())
    (stage / 'THIRD-PARTY-NOTICES.txt').write_text(text, encoding='utf-8')
    shutil.copy2(ROOT / 'packaging/windows-downloads.lock.json', stage / 'WINDOWS-DOWNLOADS.json')
    release = ROOT / 'release'
    release.mkdir(exist_ok=True)
    output = release / f'FileCraft-{VERSION}-windows-x64-portable.zip'
    archive_folder(stage, output)
    from source_archive import source_files
    source = release / f'FileCraft-{VERSION}-windows-x64-source.zip'
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in source_files():
            archive.write(path, Path('FileCraft') / path.relative_to(ROOT))
    checksum = release / f'FileCraft-{VERSION}-windows-x64-SHA256SUMS.txt'
    checksum.write_text(''.join(f'{digest(path)}  {path.name}\n' for path in (output, source)), encoding='utf-8')
    print(f'Created {output} ({output.stat().st_size / 1024**2:.1f} MB)', flush=True)
    print(f'Source: {source}\nChecksums: {checksum}\nWindows device testing is still required.', flush=True)


if __name__ == '__main__':
    main()
