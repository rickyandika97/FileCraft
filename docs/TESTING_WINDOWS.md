FileCraft 1.1.0 — Windows x64 test build

For a 64-bit Intel/AMD PC running Windows 10 or Windows 11.
Built on an Apple Silicon Mac. This 1.1.0 package needs a Windows launch
check. The previous 1.0.2 package passed Windows 10 x64 diagnostics, and the user
confirmed all three tools, saving files, and reopening. See docs/SESSION_HANDOFF.md
in the source download for the test record and unconfirmed cases.

GET STARTED

1. Copy FileCraft-1.1.0-windows-x64-portable.zip to your Windows PC.
2. Right-click the ZIP and choose Extract All. Keep the entire folder together.
3. Open FileCraft.exe in the extracted FileCraft folder.
   It should open its own window. Python and PDF tools are included.
   No Python installation or Terminal window is needed.

WINDOWS COMPONENTS

The app uses Microsoft Edge WebView2 Runtime and .NET Framework 4.6.2 or newer.
WebView2 is included with Windows 11 and most Windows 10 PCs.
The PDF engine also needs the Microsoft Visual C++ x64 runtime.

If the app says WebView2 is missing, open prerequisites/MicrosoftEdgeWebview2Setup.exe.
That Microsoft installer needs internet and installs the shared WebView2 Runtime.
If PDF tools fail or MSVCP140.dll is missing, open prerequisites/VC_redist.x64.exe.
That included Microsoft installer works offline. Choose Install, or Repair if offered.
Then reopen the app. All photo and PDF processing stays local.

The test launcher is unsigned. Windows may show a publisher warning on first launch.

PLEASE TEST

- Open and close the app, then reopen it.
- Add a folder of photos, including a folder name with spaces or Indonesian text.
- Shrink a photo and a PDF; confirm the saved copies meet the selected size limit.
- Crop and watermark portrait and landscape photos.
- Combine PDF and image pages, rearrange them, then split/extract selected pages.
- Choose a save folder; cancel once, then choose a folder and export.
- Use Open folder after export; it should open Windows Explorer.
- Confirm originals stay untouched and copies appear in a separate batch folder.
- Reopen the app and check that watermark preferences and save locations are retained.
- Start a larger batch and try closing the app; cancel the close confirmation.
  Finish the batch, then close normally. Also test confirming a busy close on throwaway files.

IF SOMETHING FAILS

Double-click Diagnose Windows.bat. It checks the included runtime, settings storage,
PDF worker, PDF preview/export and native window dependencies.
The report is saved to:
%LOCALAPPDATA%/FileCraft/windows-diagnostics.txt

Send that report along with what you clicked and the error you saw.
Other logs are desktop.log and errors.log in the same settings folder.
Closing the app stops its local service. The app needs no administrator privileges;
Microsoft prerequisite installers may ask for permission separately.

SOURCE AND LICENSE

GNU AGPL version 3; see LICENSE and THIRD-PARTY-NOTICES.txt.
The matching windows-x64-source.zip contains the app and build scripts.
