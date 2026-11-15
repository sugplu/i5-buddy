#!/usr/bin/env python3
"""Make every app icon from the one master drawing, icons/app-icon.svg.

Run:  python3 tools/icons.py          (then bump VERSION in sw.js; re-render the link preview with tools/og_image.py)

icons/app-icon.svg is the logo as a full-bleed 1024 x 1024 square (no rounded corners, no transparency): the iPhone
app's App Store icon is the same drawing (i5-buddy-ios/assets/app-icon.svg). From it this writes:

  icons/icon.svg              the rounded tile: favicon, manifest "any", and the logo inside the app (header, bingo,
                              passport, map card, privacy and support pages, link preview)
  icons/icon-512.png          the rounded tile, transparent corners (manifest; the share card draws it on a canvas)
  icons/icon-192.png          the same at 192
  icons/icon-180.png          apple-touch-icon: full-bleed square (iOS rounds the corners itself)
  icons/icon-maskable-512.png manifest "maskable": full bleed, from icons/app-icon-maskable.svg (the same drawing with
                              the logo shrunk into Android's safe circle, 80% of the side) or else the master itself

The master's ids are prefixed (e.g. "i5-sky"), so the tile can wrap it without clashes. Headless Chrome draws the
PNGs; like og_image.py it renders in a taller window and keeps the top rows (rows below the page area come out wrong).
"""
import base64, os, re, struct, subprocess, sys, tempfile, zlib

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")
MASTER = os.path.join(ICONS, "app-icon.svg")
RADIUS = 230  # the tile's corner radius on the 1024 grid (22.5%, close to the iOS icon shape)
MASKABLE = os.path.join(ICONS, "app-icon-maskable.svg")  # optional: the master with its logo inside the safe circle


def chunks(png):
    i = 8
    while i < len(png):
        n, kind = struct.unpack(">I4s", png[i:i + 8])
        yield kind, png[i + 8:i + 8 + n]
        i += 12 + n


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def top_rows(png, h):
    """The top h rows of an 8-bit RGB or RGBA PNG (each scanline's filter only looks at itself and the row above)."""
    assert png[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    parts = list(chunks(png))
    w, height, depth, color, comp, filt, lace = struct.unpack(">IIBBBBB", dict(parts)[b"IHDR"])
    assert depth == 8 and color in (2, 6) and lace == 0 and height >= h, (depth, color, lace, height)
    stride = 1 + w * (3 if color == 2 else 4)
    raw = zlib.decompress(b"".join(d for k, d in parts if k == b"IDAT"))
    ihdr = struct.pack(">IIBBBBB", w, h, depth, color, comp, filt, lace)
    return png[:8] + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw[:h * stride], 9)) + chunk(b"IEND", b"")


def inner(svg):
    """The master's content between its <svg ...> and </svg> tags."""
    m = re.search(r"<svg\b[^>]*>(.*)</svg>\s*$", svg, re.S)
    if not m:
        sys.exit("icons/app-icon.svg: no <svg> element")
    return m.group(1).strip("\n")


def tile_svg(master):
    """The rounded tile: the master clipped to a rounded square."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n'
            "<!-- Made by tools/icons.py from icons/app-icon.svg: edit that file, not this one. -->\n"
            f'<clipPath id="i5tile-clip"><rect width="1024" height="1024" rx="{RADIUS}"/></clipPath>\n'
            f'<g clip-path="url(#i5tile-clip)">\n{inner(master)}\n</g>\n</svg>\n')


def render(svg_text, size, out, tmp, transparent):
    data = base64.b64encode(svg_text.encode()).decode()
    html = os.path.join(tmp, "icon.html")
    with open(html, "w") as f:
        f.write('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}'
                f'img{{display:block}}</style><img src="data:image/svg+xml;base64,{data}" width="{size}" height="{size}">')
    shot = os.path.join(tmp, "shot.png")
    args = [CHROME, "--headless=new", "--hide-scrollbars", "--mute-audio", "--force-device-scale-factor=1",
            f"--user-data-dir={os.path.join(tmp, 'profile')}", f"--window-size={max(size, 64)},{size + 200}",
            "--virtual-time-budget=3000", f"--screenshot={shot}", "file://" + html]
    if transparent:
        args.insert(1, "--default-background-color=00000000")
    subprocess.run(args, capture_output=True, timeout=120, check=True)
    png = top_rows(open(shot, "rb").read(), size)
    w, h = struct.unpack(">II", png[16:24])
    if w < size:
        sys.exit(f"{out}: Chrome drew {w} px wide, expected {size}")
    if w != size:  # a window wider than the icon (tiny sizes): keep the left `size` columns
        png = left_cols(png, size)
    with open(out, "wb") as f:
        f.write(png)
    print(f"{os.path.relpath(out, ROOT)}: {size}x{size}, {len(png) // 1024} KB")


def left_cols(png, wnew):
    parts = list(chunks(png))
    w, h, depth, color, comp, filt, lace = struct.unpack(">IIBBBBB", dict(parts)[b"IHDR"])
    bpp = 3 if color == 2 else 4
    raw = zlib.decompress(b"".join(d for k, d in parts if k == b"IDAT"))
    stride, out, prev = 1 + w * bpp, bytearray(), bytearray(w * bpp)
    for y in range(h):  # unfilter each row, then write it unfiltered (filter 0) and cut to wnew
        f, line = raw[y * stride], bytearray(raw[y * stride + 1:(y + 1) * stride])
        for x in range(len(line)):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out += b"\x00" + line[:wnew * bpp]
        prev = line
    ihdr = struct.pack(">IIBBBBB", wnew, h, depth, color, comp, filt, lace)
    return png[:8] + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(out), 9)) + chunk(b"IEND", b"")


def main():
    master = open(MASTER).read()
    if re.search(r"<(text|image|script|foreignObject)\b", master):
        sys.exit("icons/app-icon.svg must be plain shapes: no <text>, <image>, <script> or <foreignObject>")
    tile = tile_svg(master)
    with open(os.path.join(ICONS, "icon.svg"), "w") as f:
        f.write(tile)
    print("icons/icon.svg: rounded tile")
    with tempfile.TemporaryDirectory(prefix="i5icons-") as tmp:
        render(tile, 512, os.path.join(ICONS, "icon-512.png"), tmp, True)
        render(tile, 192, os.path.join(ICONS, "icon-192.png"), tmp, True)
        render(master, 180, os.path.join(ICONS, "icon-180.png"), tmp, False)
        mask = open(MASKABLE).read() if os.path.exists(MASKABLE) else master
        render(mask, 512, os.path.join(ICONS, "icon-maskable-512.png"), tmp, False)


if __name__ == "__main__":
    main()
