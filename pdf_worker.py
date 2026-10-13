"""Rewrite PDF images without rasterizing pages or flattening text, links or forms."""
import json
from pathlib import Path
import shutil
import sys


def compress_pdf(source, output, limit):
    import pymupdf
    try:
        document = pymupdf.open(source)
    except Exception:
        raise ValueError('This PDF is damaged or unreadable.') from None
    with document:
        if not document.is_pdf:
            raise ValueError('This file is not a PDF.')
        pages = document.page_count if not document.needs_pass else None
        if pages == 0:
            raise ValueError('This PDF has no pages.')
        if source.stat().st_size < limit:
            shutil.copyfile(source, output)
            return {'size': output.stat().st_size, 'pages': pages, 'copied': True}
        if document.needs_pass or document.is_encrypted:
            raise ValueError('This PDF is password-protected. Use an unlocked copy to compress it.')
        if document.get_sigflags() > 0:
            raise ValueError('This PDF contains a digital signature. Compression would invalidate it; the original was kept.')
    target = int(limit * .97)
    # Try lossless cleanup first, then progressively reduce embedded image detail.
    profiles = [(None, None), (300, 92), (240, 88), (180, 84), (150, 80), (120, 75), (96, 65)]
    for dpi, quality in profiles:
        with pymupdf.open(source) as candidate:
            if dpi:
                candidate.rewrite_images(dpi_threshold=int(dpi*1.25), dpi_target=dpi, quality=quality)
            candidate.save(output, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True,
                           use_objstms=1, compression_effort=100, encryption=pymupdf.PDF_ENCRYPT_KEEP,
                           raise_on_repair=True)
        if output.stat().st_size <= target:
            with pymupdf.open(output) as verified:
                if verified.page_count != pages:
                    raise ValueError('The PDF page count changed. No copy was saved.')
            return {'size': output.stat().st_size, 'pages': pages, 'copied': False}
    raise ValueError('This PDF cannot fit the selected limit while keeping its pages. Choose a larger limit. No oversized copy was saved.')


def main():
    if sys.argv[1:] == ['--check']:
        import pymupdf
        import pypdf
        if pymupdf.VersionBind != '1.28.2' or pypdf.__version__ != '6.20.0':
            raise SystemExit(1)
        return
    try:
        result = compress_pdf(Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]))
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'error': str(error) or 'Could not process this PDF.'}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
