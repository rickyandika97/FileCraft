"""Render the FileCraft mark for both native desktop platforms."""
def render_icon():
    from PIL import Image, ImageDraw
    image = Image.new('RGBA', (1024, 1024))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((65, 75, 959, 969), radius=210, fill='#00000018')
    draw.rounded_rectangle((60, 55, 964, 959), radius=210, fill='#365C47')
    draw.rounded_rectangle((115, 110, 909, 904), radius=165, outline='#94AA7D', width=8)
    # Geometric FC monogram: identical on Mac, Windows and in the browser.
    draw.polygon([(258, 342), (462, 342), (462, 403), (324, 403),
                  (324, 479), (442, 479), (442, 540), (324, 540),
                  (324, 662), (258, 662)], fill='#F5F2E8')
    draw.arc((503, 331, 779, 671), 48, 312, fill='#B9CE9A', width=62)
    return image
