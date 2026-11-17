#!/usr/bin/env python3
"""List every unit the natural voice needs: serve the repo, open tools/voice/units.html in headless Chrome (silent: the
page sets window.__BUDDY_SILENT__ and loads the app with ?silent=1; Chrome runs with --mute-audio --disable-audio-output),
and save what the page POSTs to tools/voice/units.json.

Run:  python3 tools/voice/collect.py        (then tools/voice/make.py records the clips that are missing)
"""
import http.server, json, os, shutil, socketserver, subprocess, sys, tempfile, threading, time

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "tools", "voice", "units.json")
got = threading.Event()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=REPO, **k)

    def log_message(self, *a):
        pass

    def do_POST(self):
        if self.path != "/__units":
            self.send_error(404)
            return
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n)
        data = json.loads(body)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=0)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")
        got.set()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    request_queue_size = 64


def main():
    global OUT
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default="tools/voice/units.html", help="the page to open (it POSTs its JSON to /__units)")
    ap.add_argument("--out", default=OUT, help="where to save what the page sends")
    a = ap.parse_args()
    OUT = os.path.abspath(a.out)
    srv = Server(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    prof = tempfile.mkdtemp(prefix="i5-units-")
    cmd = [CHROME, "--headless=new", "--mute-audio", "--disable-audio-output", "--disable-gpu", f"--user-data-dir={prof}",
           "--no-first-run", "--no-default-browser-check", "--enable-logging=stderr", "--v=0", "--window-size=430,932",
           f"http://127.0.0.1:{port}/{a.page}"]
    chrome = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    lines = []
    threading.Thread(target=lambda: [lines.append(l) for l in chrome.stderr], daemon=True).start()
    ok = got.wait(180)
    time.sleep(0.5)
    chrome.terminate()
    try:
        chrome.wait(10)
    except subprocess.TimeoutExpired:
        chrome.kill()
    srv.shutdown()
    shutil.rmtree(prof, ignore_errors=True)
    for l in lines:
        if "[units]" in l:
            print(l.split("[units]", 1)[1].split('", source')[0].strip())
    if not ok:
        print("FAIL: the page never sent its list", file=sys.stderr)
        for l in lines[-20:]:
            print("  " + l.rstrip()[:200], file=sys.stderr)
        sys.exit(1)
    data = json.load(open(OUT, encoding="utf-8"))
    if "units" in data:
        print(f"saved {len(data['units'])} units to {os.path.relpath(OUT, REPO)}; clashes: {len(data['clashes'])}")
    else:
        print(data.get("title", ""))
        for r in data.get("rows", []):
            print("  " + r)
        if "ALL PASS" not in data.get("title", ""):
            sys.exit(1)


if __name__ == "__main__":
    main()
