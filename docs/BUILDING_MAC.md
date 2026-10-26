# Build the Mac app

The tested build uses an Apple Silicon Mac and Python 3.14 from
[python.org](https://www.python.org/downloads/macos/). Install-time internet is
needed to download the dependencies; the finished app works offline.

From the project folder, run:

```sh
python3 -m venv .build-venv
.build-venv/bin/python -m pip install -r packaging/mac-requirements.txt
.build-venv/bin/python packaging/build_mac.py
```

The dependency lock file records the versions used for this release. The script
bundles Python, PyMuPDF, pypdf and the interface, adds the FC icon, fixes Cocoa
folder selection, includes the project and dependency licenses, verifies the
app's ad-hoc signature, and creates and checks the DMG.

The outputs are:

- `dist/FileCraft.app` — the desktop application.
- `release/FileCraft-1.2.0-arm64.dmg` — the installer to share.
- `build/mac/` — temporary packaging files and caches.

The Apple Silicon build requires macOS 11 or newer and has been tested on macOS
15.6.1. It does not run on Intel Macs. An Intel version requires a separate build
and validation on an Intel build environment.

The script applies a small patch to pywebview in the build environment. Use a
dedicated `.build-venv` rather than your system Python environment.

## Signing

This script creates an ad-hoc signed personal build. It does not submit the app to
Apple or notarize it. On another Mac, macOS may require approval in System Settings
→ Privacy & Security before opening it. Developer ID signing and notarization are
separate release steps if you choose to add them later.

## Make the source download

The repository includes the complete app source and packaging scripts. To create a
source-only download and an unpacked folder for a GitHub browser upload:

```sh
python3 packaging/source_archive.py
```

This writes `release/FileCraft-1.2.0-source.zip` and
`release/github-source/FileCraft/`. It uses an explicit list of source files
and includes the PDF test fixtures. It excludes installed dependencies, DMGs,
compiled apps, caches, personal exports, save history and local validation files.

The distributed dependency notices are kept in `THIRD-PARTY-NOTICES.txt`. The Mac
build also generates notices from the actual installed dependency versions and
includes them on the DMG and inside the application.
