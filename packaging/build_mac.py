"""Reproducible local Apple Silicon .app and drag-to-Applications DMG build."""
from pathlib import Path
import importlib.metadata
import platform
import shutil
import subprocess
import sys
from brand_icon import render_icon

ROOT = Path(__file__).resolve().parents[1]
NAME = 'FileCraft'
VERSION = '1.0.3'


def run(*command, **kwargs):
    subprocess.run(command, cwd=ROOT, check=True, **kwargs)


def patch_folder_picker():
    # pywebview 6.2.1's Cocoa delegate ignores WKOpenPanelParameters.allowsDirectories.
    # Preserve native webkitdirectory inputs without exposing filesystem APIs to JS.
    # https://developer.apple.com/documentation/webkit/wkopenpanelparameters/allowsdirectories
    import webview
    cocoa = Path(webview.__file__).parent / 'platforms/cocoa.py'
    original = '''files = i.create_file_dialog(
                FileDialog.OPEN,
                '',
                param.allowsMultipleSelection(),
                '',
                file_filter,'''
    replacement = '''files = i.create_file_dialog(
                FileDialog.FOLDER if param.allowsDirectories() else FileDialog.OPEN,
                '',
                param.allowsMultipleSelection(),
                '',
                None if param.allowsDirectories() else file_filter,'''
    source = cocoa.read_text()
    if replacement in source:
        return
    if source.count(original) != 1:
        raise RuntimeError('The pywebview Cocoa folder-picker patch needs review.')
    cocoa.write_text(source.replace(original, replacement))
    shutil.rmtree(cocoa.parent / '__pycache__', ignore_errors=True)


def make_icon(build):
    from PIL import Image
    image = render_icon()
    iconset = build / 'FileCraft.iconset'
    iconset.mkdir(parents=True, exist_ok=True)
    for points in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f'icon_{points}x{points}' + ('@2x' if scale == 2 else '') + '.png'
            image.resize((points * scale, points * scale), Image.Resampling.LANCZOS).save(iconset / name)
    icon = build / 'FileCraft.icns'
    image.save(icon, format='ICNS')
    return icon


def notices():
    result = [f'FileCraft {VERSION} — third-party software notices',
              'Python and the following open-source components are included in this app.',
              'Bundled component license files are below. macOS WebKit is provided by Apple.',
              'FileCraft is licensed under GNU AGPL version 3. See LICENSE.',
              'Pinned dependency source locations:',
              'PyMuPDF/MuPDF 1.28.2: https://github.com/pymupdf/PyMuPDF/tree/1.28.2',
              'MuPDF 1.28.2: https://github.com/ArtifexSoftware/mupdf/tree/1.28.2',
              'pypdf 6.20.0: https://github.com/py-pdf/pypdf/tree/6.20.0',
              'pywebview 6.2.1: https://github.com/r0x0r/pywebview/tree/6.2.1',
              'The pywebview Cocoa modification is in packaging/build_mac.py in this source distribution.']
    packages = ('pywebview', 'PyMuPDF', 'pypdf', 'Pillow', 'PyInstaller', 'pyobjc-core', 'pyobjc-framework-Cocoa',
                'pyobjc-framework-Quartz', 'pyobjc-framework-WebKit', 'pyobjc-framework-Security',
                'pyobjc-framework-UniformTypeIdentifiers', 'proxy_tools', 'bottle', 'typing_extensions')
    for package in packages:
        dist = importlib.metadata.distribution(package)
        result.append(f'\n===== {package} {dist.version} =====')
        for value in dist.metadata.get_all('Project-URL', []):
            result.append(value)
        if dist.metadata.get('Home-page'):
            result.append(f'Project: {dist.metadata["Home-page"]}')
        for file in dist.files or []:
            name = file.name.lower()
            if name in ('license', 'copying', 'notice') or (
                    name.startswith(('license.', 'copying.', 'notice.'))
                    and file.suffix.lower() in ('.txt', '.md', '.rst', '.rtf')):
                path = dist.locate_file(file)
                if path.is_file():
                    result.append(f'\n{file.name}\n{path.read_text(errors="replace")}')
    python_license = Path(sys.base_prefix) / f'lib/python{sys.version_info.major}.{sys.version_info.minor}/LICENSE.txt'
    if python_license.exists():
        result.append('\n===== Python =====\n' + python_license.read_text(errors='replace'))
    result.append('\n===== GNU AGPL version 3 =====\n' + (ROOT / 'LICENSE').read_text())
    return '\n'.join(result)


def main():
    if sys.platform != 'darwin':
        raise SystemExit('Run this build on a Mac.')
    build = ROOT / 'build/mac'
    build.mkdir(parents=True, exist_ok=True)
    patch_folder_picker()
    icon = make_icon(build)
    license_file = build / 'THIRD-PARTY-NOTICES.txt'
    license_file.write_text(notices())
    assets = build / 'web-assets'
    if assets.exists():
        shutil.rmtree(assets)
    shutil.copytree(ROOT / 'app', assets)
    html = assets / 'index.html'
    html.write_text(html.read_text().replace(
        'First-time PDF setup needs internet; your files stay on this computer.',
        'PDF tools are included; your files stay on this computer.').replace(
        'First-time PDF setup needs an internet connection; your files stay on this computer.',
        'PDF tools are included and work offline; your files stay on this computer.'))
    spec = build / 'FileCraft.spec'
    spec.write_text(f'''# Generated by packaging/build_mac.py.
from PyInstaller.utils.hooks import collect_all
pdf_data, pdf_binaries, pdf_hidden = collect_all('pymupdf')
a = Analysis([{str(ROOT / 'desktop.py')!r}], pathex=[{str(ROOT)!r}],
    binaries=pdf_binaries,
    datas=pdf_data + [({str(assets)!r}, 'app'), ({str(license_file)!r}, '.'), ({str(ROOT / 'LICENSE')!r}, '.')],
    hiddenimports=pdf_hidden + ['webview.platforms.cocoa'],
    excludes=['tkinter', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'gi'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name={NAME!r},
    debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
    console=False, argv_emulation=False, target_arch={platform.machine()!r},
    codesign_identity=None, entitlements_file=None)
collection = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name={NAME!r})
app = BUNDLE(collection, name={NAME + '.app'!r}, icon={str(icon)!r},
    bundle_identifier='com.filecraft.desktop',
    info_plist={{'CFBundleName': {NAME!r}, 'CFBundleDisplayName': {NAME!r},
                'CFBundleShortVersionString': {VERSION!r}, 'CFBundleVersion': '4',
                'LSMinimumSystemVersion': '11.0', 'NSHighResolutionCapable': True,
                'NSHumanReadableCopyright': 'FileCraft contributors. GNU AGPLv3; includes open-source components.'}})
''')
    # Keep build caches in this workspace instead of the user's global cache.
    import os
    env = {**os.environ, 'PYINSTALLER_CONFIG_DIR': str(build / 'pyinstaller-cache')}
    run(sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
        '--distpath', str(ROOT / 'dist'), '--workpath', str(build / 'pyinstaller'), str(spec), env=env)
    app = ROOT / 'dist' / (NAME + '.app')
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', str(app))
    stage = build / 'dmg'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir()
    run('/usr/bin/ditto', str(app), str(stage / app.name))
    (stage / 'Applications').symlink_to('/Applications')
    (stage / 'INSTALL.txt').write_text(
        f'FileCraft {VERSION}\n\n'
        'For Apple Silicon Macs (M1 or newer), macOS 11 or newer. Tested on macOS 15.6.1.\n\n'
        'Drag FileCraft into Applications, eject this disk, then open the app.\n'
        'Python and PDF tools are included. No Terminal window or internet setup is needed.\n'
        'Choose a save folder when exporting. Your originals are never replaced.\n\n'
        'This personal build is ad-hoc signed, not Apple notarized. On another Mac,\n'
        'macOS may require approving it in System Settings > Privacy & Security.\n\n'
        'Settings and logs: ~/Library/Application Support/FileCraft/\n'
        'See THIRD-PARTY-NOTICES.txt for the included component licenses.\n')
    shutil.copy2(license_file, stage)
    shutil.copy2(ROOT / 'LICENSE', stage)
    release = ROOT / 'release'
    release.mkdir(exist_ok=True)
    dmg = release / f'FileCraft-{VERSION}-{platform.machine()}.dmg'
    if dmg.exists():
        dmg.unlink()
    run('/usr/bin/hdiutil', 'create', '-volname', NAME, '-srcfolder', str(stage),
        '-format', 'UDZO', '-ov', str(dmg))
    run('/usr/bin/hdiutil', 'verify', str(dmg))
    print(f'Created {dmg}')


if __name__ == '__main__':
    main()
