# Share on GitHub

Use the repository for the source and build instructions, and a GitHub Release for
the ready-to-install DMG. GitHub Releases support compiled downloads alongside
source archives. See [GitHub's release guide](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## Upload the source

If using Git, commit the source files from this project folder. `.gitignore`
excludes the local builds, dependency environment, downloads and exports.

If using GitHub's browser uploader, upload the **contents** of
`release/github-source/FileCraft/`. This folder is prepared by
`python3 packaging/source_archive.py`. Include its hidden `.gitignore` and
`.gitattributes` files. Do not upload the ZIP as a source-code file; extract it
first if you are using the source ZIP instead of the prepared folder.

The repository should contain `README.md`, `LICENSE`, dependency notices, the
launchers, Python files, and the `app/`, `docs/`, `packaging/` and `tests/` folders.

## Add the Mac download

Once the source is in the repository:

1. Open **Releases → Draft a new release**.
2. Create the tag `v1.0.3` against the source commit for this build.
3. Use **FileCraft 1.0.3** as the release title.
4. Attach `FileCraft-1.0.3-arm64.dmg`,
   `FileCraft-1.0.3-source.zip`, `SHA256SUMS.txt`, and
   `THIRD-PARTY-NOTICES.txt` from the local `release/` folder.
5. Describe Apple Silicon/macOS compatibility and the signing status, then publish
   the release when ready.

GitHub also creates source downloads from the tagged repository. Keep the explicit
source ZIP with the DMG so users can obtain the exact source and build scripts
used for that download. Pinned upstream dependency source locations are in the
dependency notices; third-party components retain their respective licenses.

## Suggested release description

```text
FileCraft 1.0.3

Local tools for shrinking photos and PDFs, cropping and watermarking photos,
and combining or splitting PDF pages. Each Save or Export asks for its folder.
Originals are preserved.

Mac download: Apple Silicon (M1 or newer), macOS 11 or newer.
Python and PDF tools are included; the app works offline.
Ad-hoc signed; not Apple-notarized. macOS may require approval on first launch.

Source and build instructions are included. GNU AGPLv3 license.
```

## Windows test download

Current status and Windows test results are recorded in
[SESSION_HANDOFF.md](SESSION_HANDOFF.md). On 13 October 2026, the user supplied
passing Windows 10 x64 diagnostics and confirmed all three tools, saving files,
and reopening the previous 1.0.2 app. The renamed FileCraft 1.0.3 package needs a
Windows launch check. Windows publication has not been performed.

The Mac-built Windows x64 portable app is a separate test download. Follow
[BUILDING_WINDOWS.md](BUILDING_WINDOWS.md) to rebuild it. Its release assets are
`FileCraft-1.0.3-windows-x64-portable.zip`, the matching
`windows-x64-source.zip`, and `windows-x64-SHA256SUMS.txt`. Record the previous
1.0.2 Windows 10 results separately from the renamed 1.0.3 package's launch check.
Detailed checklist cases and Windows 11 remain unconfirmed; see
[the Windows checklist](TESTING_WINDOWS.md) and the test record.
It targets Windows 10/11 on 64-bit Intel/AMD PCs and includes the official
Microsoft prerequisite installers for machines that need them.

When making a new version, update `VERSION` and `CFBundleVersion` in
`packaging/build_mac.py`, update the release references in the docs, build the app,
run the checks, and regenerate the source ZIP and checksums. Do not replace a
published version's assets with a different build under the same tag.
