# Build the Windows x64 app on a Mac

FileCraft 1.2.0 adds photo rotation, independent watermark placement per photo,
and draggable watermarks in Final preview. Start with
[SESSION_HANDOFF.md](SESSION_HANDOFF.md) when resuming. The previous 1.0.2 package
passed Windows 10 x64 diagnostics and user checks for all three tools, saving,
and reopening. Version 1.2.0 needs a Windows launch check.

This produces a portable ZIP with a native Windows `.exe` launcher, an isolated
CPython 3.13.16 x64 runtime, pywebview and the PDF tools. It uses official Windows
binaries and cross-compiles only the small launcher with Zig. PyInstaller is not
used for this build, because its Windows bundles must be built on Windows.

The app targets Windows 10/11 on 64-bit Intel/AMD PCs. It uses the Windows .NET
Framework and the shared Microsoft Edge WebView2 Runtime. Official Microsoft
WebView2 and Visual C++ installers are included under `prerequisites/` for machines
that need them. WebView2's bootstrapper requires internet if that runtime is absent.

## Build

Use a dedicated build environment with Python 3.10+ and curl. On the existing Mac:

```sh
.build-venv/bin/python -m pip install --target build/windows/toolchain ziglang==0.14.1
.build-venv/bin/python packaging/build_windows.py
```

On a fresh Mac, first create `.build-venv` and install `Pillow==12.3.0`,
`setuptools==84.0.0` and `wheel`. Zig's Python package installs the compiler locally;
it does not modify the system toolchain. On Linux or Windows, supply the native
Zig 0.14.1 executable with `--zig /path/to/zig`.

The download lock pins URLs and SHA256 checksums for the Python runtime, Windows
wheels, the proxy_tools source package, and Microsoft installers. A changed download
fails the build and needs a reviewed lock update. `windows-requirements.txt` records
the package versions; the lock is the actual build input. No host macOS dependency
files are copied into the Windows app.

The script writes:

- `dist/windows-x64/FileCraft/` — unpacked portable app.
- `release/FileCraft-1.2.0-windows-x64-portable.zip` — copy this to Windows.
- `release/FileCraft-1.2.0-windows-x64-source.zip` — matching source.
- `release/FileCraft-1.2.0-windows-x64-SHA256SUMS.txt` — artifact checksums.
- `build/windows/` — downloads, compiler, and temporary packaging files.

The launcher is unsigned and needs no administrator rights. Preferences and logs
are stored under `%LOCALAPPDATA%/FileCraft/`. The app folder can be read-only;
exports go to the chosen save folder, and workers never try to install into the app.

## Verification

Run the existing Python and JavaScript checks on the Mac, and inspect the Windows
executable architecture and dependency files. Then follow
[the Windows test checklist](TESTING_WINDOWS.md) on an actual Windows PC.
The diagnostic batch file checks the PDF subprocess protocol and a real PDF
preview/export round trip using the included Windows Python.

Mac tests and PE file checks establish packaging evidence, not Windows execution
or device compatibility. The supplied Windows 10 diagnostics and user workflow
results apply to the previous 1.0.2 package. The 1.2.0 package needs a Windows
launch check; detailed checklist cases and Windows 11 remain unconfirmed.
See [the test record](SESSION_HANDOFF.md).
