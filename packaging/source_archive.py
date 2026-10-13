"""Make a source-only folder and ZIP for GitHub, using an explicit file list."""
from pathlib import Path
import shutil
import zipfile
from build_mac import VERSION

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    '.gitignore', '.gitattributes', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.txt',
    'Start FileCraft.command', 'Start FileCraft.bat', 'server.py', 'desktop.py',
    'pdf_support.py', 'pdf_worker.py', 'pdf_pages_worker.py',
)
DIRECTORIES = ('app', 'docs', 'packaging', 'tests')
SUFFIXES = {'.py', '.js', '.html', '.css', '.md', '.txt', '.pdf', '.c', '.json', '.svg'}


def source_files():
    paths = [ROOT / name for name in FILES]
    for directory in DIRECTORIES:
        paths.extend(path for path in (ROOT / directory).rglob('*')
                     if path.is_file() and path.suffix in SUFFIXES
                     and '__pycache__' not in path.parts and not path.is_symlink())
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f'Missing source file: {path.relative_to(ROOT)}')
    return sorted(paths)


def main():
    paths = source_files()
    release = ROOT / 'release'
    release.mkdir(exist_ok=True)
    folder = release / 'github-source' / 'FileCraft'
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for path in paths:
        target = folder / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    archive = release / f'FileCraft-{VERSION}-source.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as output:
        for path in paths:
            output.write(path, Path('FileCraft') / path.relative_to(ROOT))
    print(f'{len(paths)} source files: {folder}')
    print(f'Source archive: {archive}')


if __name__ == '__main__':
    main()
