# FileCraft

Three tools for your photos and PDFs, running locally on your computer:

- **Make files smaller** — shrink photos and PDFs to fit an upload limit.
- **Crop & watermark** — make square, wide, 4:3, or original-shape photos and add your logo.
- **Combine & split PDFs** — join PDFs and photos, rearrange pages, or extract pages.

Files stay on your computer. Every Save or Export asks where to save and creates
new copies in a separate batch folder. Originals are never overwritten.

## Mac app

Download the DMG from this repository's **Releases** section. Open it, drag
**FileCraft** into **Applications**, eject the disk, and launch the app.
Python and PDF tools are included; it opens in its own window and works offline.

The current build is **1.1.0**, for **Apple Silicon Macs (M1 or newer), macOS 11+**.
It has been tested on macOS 15.6.1. Intel Macs need a separate build.

This build is ad-hoc signed and is not Apple-notarized. macOS may require approval
in **System Settings → Privacy & Security** on another Mac.

If building locally, the installer is written to
`release/FileCraft-1.1.0-arm64.dmg`. Generated downloads are excluded from Git;
they belong in GitHub Releases.

## Windows app (test build)

The **Windows x64 portable build** is ready for testing on a 64-bit Intel/AMD PC
running Windows 10 or 11. Extract `FileCraft-1.1.0-windows-x64-portable.zip`
and open **FileCraft.exe**. Keep the extracted folder together.
Python and the PDF tools are included; the app opens in its own window.

The FileCraft 1.1.0 build was assembled on a Mac and needs a Windows launch check.
The previous 1.0.2 build passed Windows 10 x64 diagnostics (build 19045), and the
user confirmed all three tools, saving files, and reopening worked on that version.
Detailed checklist edge cases and Windows 11 remain unconfirmed; see the
[test record](docs/SESSION_HANDOFF.md).
Microsoft WebView2 and the Visual C++ x64 runtime are prerequisites; official
installers are included for PCs that need them. WebView2 setup needs internet
if its runtime is missing. See the [Windows test checklist](docs/TESTING_WINDOWS.md)
and [Windows build guide](docs/BUILDING_WINDOWS.md).

## Run from source on Mac or Windows

Install Python 3.10+ from [python.org](https://www.python.org/downloads/), download
or clone the source, and keep the source folder together in a writable location.

- **Mac:** double-click `Start FileCraft.command`.
- **Windows:** double-click `Start FileCraft.bat`; use Edge or Chrome.

The launcher opens the interface in your browser. Keep its Terminal/command window
open while using the app. Alternatively run `python3 server.py` on Mac or
`py -3 server.py` on Windows.

The source version downloads its PDF helpers on first PDF use, so that setup needs
internet once. PDF processing then stays local. The source/browser workflow has
not been separately validated on Windows.

## Guides

- [Current build, Windows test results and next steps](docs/SESSION_HANDOFF.md)
- [Using all three tools](docs/USAGE.md)
- [Build the Mac app and source download](docs/BUILDING_MAC.md)
- [Build the Windows x64 portable app](docs/BUILDING_WINDOWS.md)
- [Share source and downloads on GitHub](docs/RELEASING.md)
- [Development, tests and folder layout](docs/DEVELOPMENT.md)

## License

FileCraft is licensed under **GNU AGPL version 3**. See [LICENSE](LICENSE).
Third-party components retain their respective licenses; notices and pinned
upstream source locations are in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
