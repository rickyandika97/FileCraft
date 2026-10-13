"""Isolated page previews and lossless PDF page assembly for the local app."""
import json
from pathlib import Path
import sys


def prepare(source, kind, folder):
    import pymupdf as fitz
    try:
        document = fitz.open(source)
    except Exception:
        raise ValueError('This file is damaged or unreadable.') from None
    with document:
        if kind == 'pdf':
            if not document.is_pdf:
                raise ValueError('This file is not a PDF.')
            if document.needs_pass or document.is_encrypted:
                raise ValueError('This PDF is password-protected. Add an unlocked copy.')
            if document.get_sigflags() > 0:
                raise ValueError('This PDF has a digital signature. Rearranging it would invalidate the signature. Add an unsigned copy.')
            if not 0 < document.page_count <= 300:
                raise ValueError('Add PDFs with 1 to 300 pages at a time.')
            # Retain the original PDF bytes, including page resources and widgets.
            (folder / 'document.pdf').write_bytes(source.read_bytes())
        else:
            if document.is_pdf or document.page_count != 1:
                raise ValueError('Add a PNG or JPG image.')
            pixmap = fitz.Pixmap(str(source))
            pixels = pixmap.width * pixmap.height
            del pixmap
            if pixels > 48000000:
                raise ValueError('Add photos with at most 48 million pixels. Resize this photo first.')
            if kind == 'png':
                # Keep the PNG alpha channel so transparent pixels appear on white paper.
                with fitz.open() as converted:
                    page = converted.new_page(width=document[0].rect.width, height=document[0].rect.height)
                    page.insert_image(page.rect, filename=str(source))
                    converted.save(folder / 'document.pdf', deflate=True)
            else:
                # MuPDF conversion respects JPEG EXIF orientation and embeds the JPEG.
                (folder / 'document.pdf').write_bytes(document.convert_to_pdf())
    pages = []
    with fitz.open(folder / 'document.pdf') as document:
        for index, page in enumerate(document):
            scale = 360 / max(page.rect.width, page.rect.height)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            (folder / f'page-{index}.jpg').write_bytes(pixmap.tobytes('jpg', jpg_quality=80))
            pages.append({'page': index, 'width': page.rect.width, 'height': page.rect.height})
    return {'pages': pages}


def assemble(config, output):
    import pymupdf as fitz
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, NameObject, NumberObject, TextStringObject
    from collections import defaultdict
    pages = config['pages']
    if not pages or len(pages) > 1000:
        raise ValueError('Choose from 1 to 1000 pages to save.')
    writer = PdfWriter()
    readers = []
    copied = {}
    expected_widgets = 0
    by_source = defaultdict(list)
    for item in pages:
        key = (item['source'], item['page'])
        if key in copied:
            raise ValueError('Choose each page only once in an output.')
        copied[key] = None
        by_source[item['source']].append(item['page'])
    for index, (source, numbers) in enumerate(by_source.items()):
        path = config['sources'][source]
        reader = PdfReader(path)
        # Load the page tree before changing form roots (pypdf uses lazy loading).
        len(reader.pages)
        readers.append(reader)
        # Independent fields with duplicate partial names must remain independently
        # addressable. Shared widgets under one field parent retain their linkage.
        visited = set()
        def unique_field_names(references):
            used = {}
            reserved = {str(reference.get_object().get('/T')) for reference in references if reference.get_object().get('/T') is not None}
            for reference in references:
                field = reference.get_object()
                identity = id(field)
                if identity in visited:
                    continue
                visited.add(identity)
                name = field.get('/T')
                if name is not None:
                    name = str(name)
                    if name in used:
                        suffix = 2
                        while f'{name} ({suffix})' in reserved:
                            suffix += 1
                        name = f'{name} ({suffix})'
                        field[NameObject('/T')] = TextStringObject(name)
                        reserved.add(name)
                    used[name] = identity
                if field.get('/Kids'):
                    unique_field_names(field['/Kids'])
        form = reader.trailer['/Root'].get('/AcroForm')
        if form:
            unique_field_names(form.get_object().get('/Fields', []))
        if len(by_source) > 1:
            reader.add_form_topname(f'document_{index+1}')
        with fitz.open(path) as document:
            for number in numbers:
                if type(number) is not int or not 0 <= number < document.page_count:
                    raise ValueError('A selected page no longer exists. Add the file again.')
                expected_widgets += len(list(document[number].widgets()))
        start = len(writer.pages)
        # Append all selected pages from each source together. This retains form
        # field trees and lets the merger resolve links across the chosen pages.
        writer.append(reader, pages=numbers, import_outline=False)
        for offset, number in enumerate(numbers):
            copied[(source, number)] = writer.pages[start+offset].indirect_reference
    # Change the page-tree order without replacing page references: links and
    # widget references continue to point to the same selected pages.
    page_tree = writer.root_object['/Pages']
    page_tree[NameObject('/Kids')] = ArrayObject([copied[(item['source'], item['page'])] for item in pages])
    page_tree[NameObject('/Count')] = NumberObject(len(pages))
    for page in writer.pages:
        page[NameObject('/Parent')] = writer.root_object.raw_get('/Pages')
    writer.write(output)
    writer.close()
    with fitz.open(output) as checked:
        if checked.page_count != len(pages):
            raise ValueError('The exported page count changed. No copy was saved.')
        widgets = [widget for page in checked for widget in page.widgets()]
        if len(widgets) != expected_widgets:
            raise ValueError('The editable fields could not be preserved. No copy was saved.')
        field_names = [widget.field_name for widget in widgets]
    # Visible appearances alone are insufficient: require the canonical field tree.
    fields = PdfReader(output).get_fields() or {}
    if any(name not in fields for name in field_names):
        raise ValueError('The editable field data could not be preserved. No copy was saved.')
    return {'pages': len(pages), 'size': output.stat().st_size}


def preview_page(source, number, output):
    import pymupdf as fitz
    with fitz.open(source) as document:
        if not 0 <= number < document.page_count:
            raise ValueError('This page no longer exists. Add the file again.')
        page = document[number]
        scale = 1400 / max(page.rect.width, page.rect.height)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        output.write_bytes(pixmap.tobytes('jpg', jpg_quality=92))
        return {'width': pixmap.width, 'height': pixmap.height}


def main():
    try:
        operation = sys.argv[1]
        if operation == 'prepare':
            result = prepare(Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]))
        elif operation == 'assemble':
            result = assemble(json.loads(Path(sys.argv[2]).read_text()), Path(sys.argv[3]))
        elif operation == 'preview':
            result = preview_page(Path(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4]))
        else:
            raise ValueError('Unknown PDF operation.')
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'error': str(error) or 'Could not process this PDF.'}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
