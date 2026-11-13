#!/usr/bin/env python3
"""Take the install screenshots that manifest.webmanifest lists for Android's install sheet:
icons/screenshot-drive.jpg and icons/screenshot-map.jpg, 540x1170 pixels each.

Run:  python3 tools/manifest_shots.py        (then bump VERSION in sw.js)

Both are a southbound demo drive through the Westside on a 390x845 phone screen at 18/13 scale (540x1170 pixels), in
the dark theme, with narration off and reduced motion (so the map's "you are here" pulse stands still). The demo is
stopped the moment it starts, so the pictures do not depend on timing:
  drive  the Drive tab at mile 346.6, 1.6 miles before Joaquin Rocks (its photo is public domain)
  map    the Map tab at mile 264.6, zoomed to 2.5, where the "you are here" marker covers no place name
Before saving, the script checks what earlier pictures got wrong: the header's "Demo drive · The Westside" must fit
without "…", and the map marker must be clear of every label. If a check fails, pick other stops in SHOTS.

It drives headless Chrome over the DevTools protocol, through the small websocket client below, so there is nothing
to install. It serves the repo root itself, like run_tests.py and og_image.py.
"""
import base64, json, os, shutil, socket, struct, subprocess, sys, tempfile, time

sys.dont_write_bytecode = True  # importing run_tests would otherwise leave a tools/__pycache__ folder
from run_tests import CHROME, serve  # noqa: E402  (serve: a server with a listen backlog Chrome can't overrun)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, SCALE = 390, 845, 18 / 13  # CSS pixels and scale: 540x1170 pixels
QUALITY = 82                     # JPEG
UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
SHOTS = [  # (file, corridor mile, direction, map zoom; None = the Drive tab)
    ("icons/screenshot-drive.jpg", 346.6, "S", None),
    ("icons/screenshot-map.jpg", 264.6, "S", 2.5),
]
MIN_CLEAR = 6  # pixels between the map's "you are here" marker and the nearest label

# Runs in every page before its own scripts: a fresh start in the dark theme, narration and live data off.
PRESET = """try {
  for (const k of Object.keys(localStorage)) if (k.startsWith("i5b:")) localStorage.removeItem(k);
  localStorage.setItem("i5b:settings", JSON.stringify({ theme: "dark", narr: false, live: false }));
} catch (e) {}"""

# Sets the scene, waits for photos and fonts, and reports the checks.
SETUP = """async (mile, way, zoom) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200 && !(window.I5BUDDY && document.querySelector("#nextCard h2")); i++) await wait(100);
  const api = window.I5BUDDY.api;
  api.voice.say = () => Promise.resolve(false);
  api.S.m = mile; api.S.dir = way;
  api.startDemo();
  api.stopAll(true); // stops the demo's clock; the screen still shows the demo drive
  if (zoom) { api.ui.go("map"); await wait(1500); api.map.showMile(mile, zoom); }
  await wait(1500);
  const imgs = () => [...document.querySelectorAll("img")].filter(x => x.offsetParent);
  for (let i = 0; i < 100 && !imgs().every(x => x.complete && x.naturalWidth); i++) await wait(100);
  await Promise.all(imgs().map(x => x.decode().catch(() => {})));
  await document.fonts.ready;
  await wait(1000); // Chrome repaints a scaled photo once more, a moment after it first shows
  const st = document.getElementById("statusText");
  const out = { at: api.S.m.toFixed(2) + " " + api.S.dir, subtitle: st.textContent, fits: st.scrollWidth <= st.clientWidth,
    next: (document.querySelector("#nextCard h2") || {}).textContent || "" };
  if (zoom) {
    const parts = [...document.querySelectorAll(".mp-you .mp-you-shadow, .mp-you .mp-you-dir, .mp-you .mp-you-core")]
      .map(e => e.getBoundingClientRect());
    const you = { left: Math.min(...parts.map(b => b.left)), right: Math.max(...parts.map(b => b.right)),
      top: Math.min(...parts.map(b => b.top)), bottom: Math.max(...parts.map(b => b.bottom)) };
    let clear = Infinity, near = "";
    for (const t of document.querySelectorAll("g.mp-city:not([display=none]) text, g.mp-city:not([display=none]) circle, .mp-plabels text")) {
      const b = t.getBoundingClientRect();
      if (!b.width) continue;
      const d = Math.hypot(Math.max(b.left - you.right, you.left - b.right, 0), Math.max(b.top - you.bottom, you.top - b.bottom, 0));
      if (d < clear) { clear = d; near = t.textContent || (t.parentNode.textContent + " (its dot)"); }
    }
    out.clear = Math.round(clear); out.nearest = near.trim();
  }
  return out;
}"""


class DevTools:
    """Just enough of a websocket client for Chrome's DevTools protocol: one connection, text messages."""

    def __init__(self, url):
        hostport, path = url[len("ws://"):].split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=120)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            self.buf += self._recv()
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise RuntimeError("DevTools refused the websocket: " + head.decode(errors="replace"))
        self.last_id = 0

    def _recv(self):
        chunk = self.sock.recv(1 << 16)
        if not chunk:
            raise EOFError("Chrome closed the DevTools connection")
        return chunk

    def _take(self, n):
        while len(self.buf) < n:
            self.buf += self._recv()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send(self, text):
        data = text.encode()
        n = len(data)
        size = bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else \
            bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)  # a client masks what it sends
        self.sock.sendall(b"\x81" + size + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(data)))

    def _message(self):
        message = b""
        while True:
            b0, b1 = self._take(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._take(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._take(8))[0]
            mask = self._take(4) if b1 & 0x80 else None
            payload = self._take(n)
            if mask:
                payload = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
            opcode = b0 & 0x0F
            if opcode == 0x8:
                raise EOFError("Chrome closed the DevTools connection")
            if opcode in (0x9, 0xA):  # ping, pong
                continue
            message += payload
            if b0 & 0x80:
                return message.decode()

    def call(self, method, session=None, **params):
        self.last_id += 1
        msg = {"id": self.last_id, "method": method, "params": params}
        if session:
            msg["sessionId"] = session
        self._send(json.dumps(msg))
        while True:  # events in between are not needed here
            reply = json.loads(self._message())
            if reply.get("id") == self.last_id:
                if "error" in reply:
                    raise RuntimeError(f"{method}: {reply['error'].get('message')}")
                return reply.get("result", {})


def jpeg_size(data):
    i = 2
    while i + 9 < len(data) and data[i] == 0xFF:
        marker, length = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + length
    return None


def shoot(dt, base, path, mile, way, zoom):
    target = dt.call("Target.createTarget", url="about:blank")["targetId"]
    s = dt.call("Target.attachToTarget", targetId=target, flatten=True)["sessionId"]
    dt.call("Emulation.setDeviceMetricsOverride", s, width=W, height=H, deviceScaleFactor=SCALE, mobile=True)
    dt.call("Emulation.setUserAgentOverride", s, userAgent=UA)
    dt.call("Emulation.setTouchEmulationEnabled", s, enabled=True, maxTouchPoints=5)
    dt.call("Emulation.setEmulatedMedia", s, features=[{"name": "prefers-reduced-motion", "value": "reduce"}])
    dt.call("Page.addScriptToEvaluateOnNewDocument", s, source=PRESET)
    dt.call("Page.navigate", s, url=base + "index.html")
    for _ in range(400):  # the app's page, loaded (Runtime.evaluate goes to whatever page is there now)
        try:
            state = dt.call("Runtime.evaluate", s, returnByValue=True,
                            expression="location.pathname.endsWith('/index.html') && document.readyState")["result"].get("value")
        except RuntimeError:
            state = None
        if state == "complete":
            break
        time.sleep(0.05)
    r = dt.call("Runtime.evaluate", s, expression=f"({SETUP})({mile}, {json.dumps(way)}, {json.dumps(zoom)})",
                awaitPromise=True, returnByValue=True)
    if "exceptionDetails" in r:
        sys.exit(f"{path}: the page failed: {r['exceptionDetails'].get('exception', {}).get('description') or r['exceptionDetails'].get('text')}")
    got = r["result"]["value"]
    problems = []
    if not got["fits"]:
        problems.append(f'the header subtitle "{got["subtitle"]}" does not fit')
    if zoom and got["clear"] < MIN_CLEAR:
        problems.append(f'the map marker is {got["clear"]} px from "{got["nearest"]}" (needs {MIN_CLEAR})')
    if problems:
        sys.exit(f"{path} at mile {got['at']}: " + "; ".join(problems) + ". Pick another stop in SHOTS.")
    data = base64.b64decode(dt.call("Page.captureScreenshot", s, format="jpeg", quality=QUALITY)["data"])
    dt.call("Target.closeTarget", targetId=target)
    want = (round(W * SCALE), round(H * SCALE))
    if jpeg_size(data) != want:
        sys.exit(f"{path}: expected {want[0]}x{want[1]}, got {jpeg_size(data)}")
    with open(os.path.join(ROOT, path), "wb") as f:
        f.write(data)
    detail = f'next: {got["next"]}' if not zoom else f'marker {got["clear"]} px clear of "{got["nearest"]}"'
    print(f'{path}: {want[0]}x{want[1]}, {len(data) // 1024} KB; mile {got["at"]}, "{got["subtitle"]}", {detail}')


def main():
    base = serve()[:-len("tools/")]  # http://127.0.0.1:PORT/ (serve() returns the tools/ address)
    tmp = tempfile.mkdtemp(prefix="i5shots-")
    chrome = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={tmp}",
                               "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        port_file = os.path.join(tmp, "DevToolsActivePort")
        for _ in range(400):
            if os.path.exists(port_file) and len(open(port_file).read().splitlines()) >= 2:
                break
            time.sleep(0.05)
        port, path = open(port_file).read().splitlines()[:2]
        dt = DevTools(f"ws://127.0.0.1:{port}{path}")
        for shot in SHOTS:
            shoot(dt, base, *shot)
    finally:
        chrome.terminate()
        try:
            chrome.wait(10)
        except subprocess.TimeoutExpired:
            chrome.kill()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
