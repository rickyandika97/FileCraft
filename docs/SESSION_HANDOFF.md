# FileCraft — progress handoff, 13 October 2026

## Current project

The app and project are now **FileCraft 1.0.3**. The name covers all three tools:
photo/PDF compression, photo cropping/watermarking, and PDF assembly/splitting.
The interface, FC logo, favicon, native icons, desktop titles, source launchers,
package identifiers, settings paths, diagnostics, notices and download names have
been updated. The app remains local and originals are preserved.

Project folder after the rename: `/Users/ricky/Desktop/FileCraft`.
Build scripts derive the root from their own location. Avoid activation scripts
that embed a previous folder path; use `.build-venv/bin/python` directly.

## Current downloads

| Artifact | Location |
| --- | --- |
| Mac app | `dist/FileCraft.app` |
| Mac installer | `release/FileCraft-1.0.3-arm64.dmg` |
| Source download | `release/FileCraft-1.0.3-source.zip` |
| Mac/source checksums | `release/SHA256SUMS.txt` |
| Windows portable download | `release/FileCraft-1.0.3-windows-x64-portable.zip` |
| Windows source download | `release/FileCraft-1.0.3-windows-x64-source.zip` |
| Windows checksums | `release/FileCraft-1.0.3-windows-x64-SHA256SUMS.txt` |
| Windows build evidence | `release/FileCraft-1.0.3-windows-x64-BUILD-NOTES.txt` |
| Unpacked Windows app | `dist/windows-x64/FileCraft/` |
| GitHub source upload folder | `release/github-source/FileCraft/` |

Previous artifacts and their original build records are preserved locally under
`.local/rebrand-20261013/`; they are excluded from Git and source downloads.
Earlier cleanup history also stays under `.local/`.

## Validation of FileCraft 1.0.3

Completed on the Mac:

- 43 Python tests and 39 JavaScript tests passed; JavaScript syntax checked.
- Native Mac window, menu, header, FC logo and three-tool chooser visually verified.
- Source and native runtime endpoints identify the app as `filecraft`; the SVG
  icon is served with its correct content type.
- Bundled Mac PDF worker check, compression, preview, preparation, page reordering
  and searchable-text preservation passed with synthetic files.
- Mac bundle metadata: FileCraft, `com.filecraft.desktop`, version 1.0.3, build 4,
  and `FileCraft.icns`. Deep/strict ad-hoc signature and DMG checksum verified.
- Windows launcher: PE32+ x86-64, GUI subsystem, FileCraft version/icon/manifest
  resources. Dependencies and runtimes are unchanged from the previous package.
- Locked Windows downloads verified; ZIP CRCs, matching source contents and SHA256
  checksums checked. No previous branding remains in active source or downloads.

The first sandboxed DMG creation could not access the macOS disk-image service.
A scoped retry with disk-image permission created the DMG and verification passed.
The Windows package is cross-built on this Apple Silicon Mac and needs a quick
Windows launch/diagnostic/save/reopen check after the rename. The existing user
results below apply to version 1.0.2, not execution of the new Windows binaries.

## Previous Windows results — version 1.0.2

Results supplied by the user on 13 October 2026, Asia/Jakarta; exact test date and
PC model were not supplied. Report: `/Users/ricky/Desktop/windows-diagnostics.txt`.
Reported platform: `Windows-10-10.0.19045-SP0 AMD64` (Windows 10 x64).
App version in the report: **1.0.2**; bundled CPython 3.13.16 x64.

All automatic checks passed: writable settings storage, pywebview 6.2.1,
PyMuPDF 1.28.2, pypdf 6.20.0, pythonnet 3.0.5, clr_loader 0.2.7.post0,
cffi 1.17.1, PDF worker startup, PDF preview/export with searchable text preserved,
and native-window dependencies/WebView2 (`edgechromium`).
The report's `windows_device_test: pending` is static build metadata.

The user explicitly confirmed **all three tools, saving files, and reopening the
app**. Detailed checklist cases were not individually confirmed.

| Check on previous 1.0.2 package | Result |
| --- | --- |
| Launch and reopen | Passed — user confirmed |
| Runtime/dependencies/PDF round trip | Passed — supplied report |
| Make files smaller | Passed — tool confirmed; exact size limits unconfirmed |
| Crop and watermark | Passed — tool confirmed; portrait/landscape cases unconfirmed |
| Combine and split PDFs | Passed — tool confirmed; individual operations unconfirmed |
| Save files | Passed — user confirmed; picker cancellation unconfirmed |
| Folder imports, spaces and non-ASCII paths | Not individually confirmed |
| Open export folder in Explorer | Not individually confirmed |
| Original files preserved, separate batch output | Not individually confirmed |
| Preferences and save locations after reopen | Not individually confirmed |
| Busy-close cancellation and confirmation | Not individually confirmed |

Windows 11 has not been tested. Use [TESTING_WINDOWS.md](TESTING_WINDOWS.md).
If anything fails, run **Diagnose Windows.bat** and collect the report,
`desktop.log` and `errors.log` from `%LOCALAPPDATA%/FileCraft/`.

## Settings and prerequisites

FileCraft uses `~/Library/Application Support/FileCraft/` on Mac and
`%LOCALAPPDATA%/FileCraft/` on Windows. The browser/source launcher uses
`.filecraft-save-locations.json` beside the launcher. Browser preferences use
`filecraft-settings`. Settings from earlier installations remain in their original
storage and are not removed; the renamed app uses its own settings storage.

Python and PDF libraries are bundled. Windows uses .NET Framework 4.6.2+,
WebView2 and the Visual C++ x64 runtime. Microsoft prerequisite installers are
included. The Windows app is portable and unsigned. The Mac app is ad-hoc signed,
not notarized. No publication or push has been requested.

## Build commands

From the FileCraft project folder:

```sh
.build-venv/bin/python -B -m unittest discover -s tests
node --test tests/crop.test.js tests/resize.test.js
.build-venv/bin/python packaging/build_mac.py
.build-venv/bin/python packaging/build_windows.py
.build-venv/bin/python packaging/source_archive.py
```

See [BUILDING_MAC.md](BUILDING_MAC.md), [BUILDING_WINDOWS.md](BUILDING_WINDOWS.md)
and [RELEASING.md](RELEASING.md). Runtime versions remain CPython 3.13.16 for Windows,
pywebview 6.2.1, PyMuPDF 1.28.2 and pypdf 6.20.0. Zig 0.14.1 is cached under
`build/windows/toolchain/ziglang/zig`. All source is currently untracked in Git.
