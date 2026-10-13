# Development and verification

For build status, current workspace location and Windows results, read
[SESSION_HANDOFF.md](SESSION_HANDOFF.md). The prior 1.0.3 Mac test evidence is
43 Python tests and 39 JavaScript tests passing. On 13 October 2026, the user
supplied passing Windows 10 x64 diagnostics and confirmed all three tools, saving
files, and reopening the previous 1.0.2 app. Version 1.1.0 adds crop shape choices
and updated tool icons. Its Mac signature and package archives were checked; tests
and Windows device behavior still need verification.

The source/browser version runs on Mac or Windows with Python 3.10+ and a modern
browser. The Mac desktop build uses Python 3.14 and the pinned dependencies under
`packaging/`. The portable Windows x64 build uses the official CPython 3.13.16
embeddable runtime and Windows-specific locked packages.

## Run from source

```sh
python3 server.py
```

On Windows, use `py -3 server.py` or `python server.py`. The included launchers run
the same service and open the default browser. Options include `--no-browser`,
`--port 8765`, and `--export-root /path/to/exports`.

The service listens only on `127.0.0.1`, checks the application origin, and requires
a session token for writes. Photos are processed by the browser and finished
copies are sent to the local service. PDF processing also stays on the computer.

## Checks

With Python and Node.js installed:

```sh
python3 -B -m unittest discover -s tests
node --test tests/crop.test.js tests/resize.test.js
```

Real PDF tests are skipped when PyMuPDF is unavailable. To install the source
version's isolated PDF helpers before running them:

```sh
python3 -B -c "from pdf_support import ensure_pdf_support; ensure_pdf_support()"
```

If using the Mac build environment, PyMuPDF and pypdf are already installed:

```sh
.build-venv/bin/python -B -m unittest discover -s tests
node --test tests/crop.test.js tests/resize.test.js
```

Keep the synthetic PDF fixtures under `tests/fixtures/`; they verify page ordering,
links, searchable text, and editable form values. They are source test assets,
not personal exports.

Automated tests and a successful build do not establish Windows or older-Mac
device compatibility. The Mac app has native-window verification on macOS 15.6.1;
the previous Windows 1.0.2 app has Windows 10 diagnostic and user workflow evidence.
The FileCraft 1.1.0 Windows package needs a launch check.
Detailed checklist cases, Windows 11 and the Windows source launcher remain unconfirmed.
See [BUILDING_WINDOWS.md](BUILDING_WINDOWS.md) and [TESTING_WINDOWS.md](TESTING_WINDOWS.md).

## Folder layout

| Path | Purpose | Included in Git/source ZIP |
| --- | --- | --- |
| `app/` | HTML, CSS and JavaScript interface | Yes |
| Root Python files | Local service, desktop launcher and PDF workers | Yes |
| `packaging/` | Mac/Windows builders, pinned dependencies and source archive helper | Yes |
| `tests/` | Automated checks and synthetic fixtures | Yes |
| `docs/` | Usage, build, development and release guides | Yes |
| `LICENSE`, `THIRD-PARTY-NOTICES.txt` | Project license and dependency notices | Yes |
| `.build-venv/`, `.pdf-tools/` | Installed local dependencies | No |
| `build/`, `dist/`, `release/` | Build artifacts and downloads | No |
| `.local/` | Preserved old builds, logs and cleanup history | No |
| `Exports/`, save-location history | Personal/local output | No |

Generated packaging files are written under `build/`, not beside the source.
