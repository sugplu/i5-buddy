#!/usr/bin/env python3
"""Render the link-preview picture: tools/og-image.html -> icons/og-1200x630.png (exactly 1200x630).

Run:  python3 tools/og_image.py            (then bump VERSION in sw.js)

Headless Chrome's page area is about 90 px shorter than --window-size, and the rows of a screenshot below it come
out wrong (they repeat the top of the page). So this renders in a taller window and keeps the top 630 rows.
Serves the repo root itself, like run_tests.py, so ../app.css, the Overpass font and ../data/i5.js load.
"""
import functools, http.server, os, struct, subprocess, sys, tempfile, threading, zlib

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons", "og-1200x630.png")
W, H = 1200, 630


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def chunks(png):
    i = 8
    while i < len(png):
        n, kind = struct.unpack(">I4s", png[i:i + 8])
        yield kind, png[i + 8:i + 8 + n]
        i += 12 + n


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def top_rows(png, h):
    """The top h rows of an 8-bit RGB or RGBA PNG. Each scanline's filter only looks at itself and the row above,
    so the first h filtered scanlines are a complete image on their own."""
    assert png[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    parts = list(chunks(png))
    w, height, depth, color, comp, filt, lace = struct.unpack(">IIBBBBB", dict(parts)[b"IHDR"])
    assert depth == 8 and color in (2, 6) and lace == 0 and height >= h, (depth, color, lace, height)
    stride = 1 + w * (3 if color == 2 else 4)
    raw = zlib.decompress(b"".join(d for k, d in parts if k == b"IDAT"))
    ihdr = struct.pack(">IIBBBBB", w, h, depth, color, comp, filt, lace)
    return png[:8] + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw[:h * stride], 9)) + chunk(b"IEND", b"")


def main():
    srv = serve()
    url = f"http://127.0.0.1:{srv.server_address[1]}/tools/og-image.html"
    with tempfile.TemporaryDirectory(prefix="i5og-") as tmp:
        shot = os.path.join(tmp, "shot.png")
        subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1",
                        f"--user-data-dir={os.path.join(tmp, 'profile')}", f"--window-size={W},{H + 200}",
                        "--virtual-time-budget=5000", f"--screenshot={shot}", url],
                       capture_output=True, timeout=120, check=True)
        png = top_rows(open(shot, "rb").read(), H)
    w, h = struct.unpack(">II", png[16:24])
    if (w, h) != (W, H):
        sys.exit(f"expected {W}x{H}, got {w}x{h}")
    with open(OUT, "wb") as f:
        f.write(png)
    srv.shutdown()
    print(f"{os.path.relpath(OUT, ROOT)}: {w}x{h}, {len(png) // 1024} KB")


if __name__ == "__main__":
    main()
