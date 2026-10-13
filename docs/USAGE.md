# Using FileCraft

## Choose a tool

Each time the app opens, choose **Make files smaller**, **Crop & watermark**, or **Combine & split PDFs**. Use **Choose another tool** to switch; each tool keeps its own files and settings while the page stays open.

## Make files smaller

1. Choose the upload limit: **Under 10 MB**, **Under 5 MB**, **Under 3 MB** (default), or **Under 2 MB**. Or choose **Custom** and move the slider to a limit from **0.1 to 20 MB**, in 0.1 MB steps. The limit applies to each file, not the whole batch; the final file may be smaller than the limit.
2. Add photos or PDFs, add a folder, or drop files/folders into the workspace. Both kinds can be saved in one batch.
3. Click **Save smaller files**, then choose a save folder in the native Mac or Windows folder picker. The tool processes and saves one file at a time. A progress bar shows the percentage and number of files finished, advancing after each file. It stays visible when the batch finishes or stops; errors are listed separately. Large PDFs can take longer before the bar advances. The **Before** and **After** columns show actual file sizes, with a total saving shown below. After sizes appear once a copy has been saved; they are not estimates.
4. Click **Open export folder** to find the new copies. Names end in `-smaller`; source folders are preserved and duplicate names get numbered suffixes.

For photos, the whole image is preserved without cropping, adding a watermark, or stretching. The tool first adjusts JPG quality, then reduces pixel dimensions when needed to fit the limit, without enlarging the original. Each encoded copy is checked in bytes before it is saved, with a small margin below the chosen limit (1 MB means 1,000,000 bytes).

Photos already strictly below the limit are copied unchanged, including JPG, PNG and WEBP. Larger photos become JPGs; transparent areas become white and original metadata is not copied. Originals are never overwritten. Stop after the current photo if needed; already saved files remain available. Failures are listed individually, and no copy above the limit is saved.

### PDF compression

PDFs stay PDFs, with their pages, selectable text, links and interactive forms retained. The app tries lossless cleanup first, then progressively reduces embedded image quality and resolution. It measures the completed PDF before saving, shows its actual file size and page count, and copies already-small PDFs without rewriting them.

PDFs up to 100 MB can be added. Some documents cannot fit very small limits without losing content; those files are reported as needing a larger limit and no oversized copy is saved. Oversized password-protected PDFs need an unlocked copy. Digitally signed PDFs are not rewritten because that would invalidate their signatures. Other files in the batch continue processing if one PDF fails.

The Mac desktop app and Windows portable test build include PyMuPDF 1.28.2 and pypdf 6.20.0. PDF processing works offline once any Windows prerequisites are installed; the Windows build still needs device validation. See [TESTING_WINDOWS.md](TESTING_WINDOWS.md) for setup and testing. The source/browser version downloads these libraries into an app-local `.pdf-tools` folder on first PDF use. That setup needs internet once. Keep the source folder writable; if setup fails offline, connect and retry. Photo tools remain available.

## Crop & watermark

1. Choose your logo. Transparent PNG is recommended; SVG, JPG, and WEBP also work. The logo is used as supplied, including any transparent padding.
2. Add photos, choose a folder, or drop photos/folders into the workspace. Photos may be JPG, PNG, or WEBP. Folder selection includes supported photos in subfolders.
3. Choose the watermark corner, size, opacity, and margin. These settings are remembered by the browser; the logo itself must be selected each time you launch a new session.
4. Select a photo and open **Adjust crop**. The crop fills a fixed square frame so you can see the details clearly, with nearby content visible in the dimmed border. Scroll up over the photo to enlarge it, and down to zoom out, or use the **Zoom** slider (100–500%). Drag the photo underneath the frame to bring other parts into view, including in both directions when zoomed in. The position slider moves the crop along the photo’s longer edge. **Reset crop** restores the centered, full-size square. Adjustments affect only that photo, including square originals.
5. Choose output size and JPG or PNG, then click **Export photos** and choose a save folder.

**Crop first, watermark second.** There is no padding or stretching. The square starts at the full shorter dimension of the source image; zooming in makes it smaller for a tighter crop. The final preview and export use the same crop. Output dimensions are limited to the selected crop’s pixels, so exports never upscale.

## Combine & split PDFs

1. Add PDFs, PNGs or JPGs, choose a folder, or drop files/folders into the workspace. Each PDF page and each photo gets a preview. Click its picture or **Preview page** to open a larger, clearer view. Use **Previous page** / **Next page** or the arrow keys to browse in the arranged order, **Zoom in** to read closely, and **Close** or Esc to return. Viewing a page does not change its tick or position. Files already added are skipped.
2. Drag pages or use their left/right arrow buttons to rearrange them. The large page numbers show the current order; each preview also names its source and original page number. Original PDF page sizes and photo proportions are kept. Photos fill their own pages without cropping, JPEG orientation is respected, and transparent PNG pixels show on white paper.
3. Tick the pages you want, use **Choose all** / **Choose none**, or enter **1, 3, 5** or **1-5** and click **Choose these pages**. Ranges include both end pages. Typed numbers refer to the current preview order; selected pages export in that order. Moving/removing pages clears typed ranges so old page numbers cannot silently select the wrong pages.
4. Choose **One PDF (chosen pages)** to combine or extract pages into one PDF. Choose **Separate PDFs (one per page)** for an individual PDF per chosen page. Choose **Separate PDFs (page ranges)** and enter one range per line, such as `1-5` then `6-10`, for a separate PDF per line. Range groups use those lines instead of the page ticks.
5. Give the new PDF a name, click **Save new PDF(s)** and choose a save folder. Multiple outputs add `-page-1` or `-part-1` to the name. The app creates a fresh batch folder and never overwrites your originals. Progress advances after each PDF; actual sizes and page counts appear once saved.

PDF pages retain searchable text, annotations and interactive fields. Field names are grouped by source when combining different documents, so similarly named fields keep independent values. Links between included pages follow the new order; links to pages left out are removed. Document-level bookmarks and attachments are not copied. This tool assembles pages without applying the shrink tool's MB limit; use **Make files smaller** on the exported PDF if needed.

Password-protected documents require unlocked copies, and PDFs with digital signature fields require unsigned copies because page changes invalidate signatures. Input files can be up to 100 MB, PDFs up to 300 pages each, and photos up to 48 million pixels. The temporary workspace holds up to 50 files, 1000 pages and 500 MB. **Clear files** and source removal release their temporary copies; stopping the local service also cleans them up. Refreshing the browser clears the visible workspace, while temporary copies remain until the service stops. Exports remain saved.

## Where files go

All three tools ask where to save on Mac and Windows. Each batch gets a new subfolder named **DD-MM-YYYY-XXXX** inside the folder you choose, for example `12-10-2026-AB12`. The last four characters are random uppercase letters and numbers. If a name is already taken, another random name is used. Every Save or Export asks for a folder for that batch. Cancelling the picker starts no export and keeps your photo list and previous results.

Click **Open export folder** when finished. Watermarked filenames end in `-square-watermarked`; smaller-photo copies end in `-smaller`. Folder structure is preserved for folder imports. Characters and names that Windows cannot save are adjusted in exported paths. Duplicate filenames receive numbered suffixes. Originals are never overwritten.

**Open export folder** opens Finder on Mac or File Explorer on Windows. If the file manager cannot open, the app reports an error and the saved copies remain in the displayed folder. The source/browser version records chosen locations in `.filecraft-save-locations.json` beside the launcher. The Mac desktop app keeps its history under `~/Library/Application Support/FileCraft/`; the Windows portable app uses `%LOCALAPPDATA%/FileCraft/`. Folder links on an open page can work after restarting the service. This history is local and is excluded from source archives. The last location is used as the starting point in the next folder picker.

Exports run one file at a time to keep memory use bounded. You can stop after the current file; already exported files stay available. Failed files are listed individually, and the remaining files continue exporting.

In the watermark tool, JPG uses 94% encoding quality and flattens any source transparency against white. PNG preserves transparency. Watermarked exports are re-encoded; original EXIF and other metadata are not copied. Browser decoding respects photo orientation. HEIC and camera RAW files should be converted to JPG or PNG first.

When updating the Mac desktop app, quit it before replacing the application. For the source/browser version, stop its Terminal/command window, launch it again, and reload the browser page.
