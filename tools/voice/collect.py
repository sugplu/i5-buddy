#!/usr/bin/env python3
"""List every unit the natural voice needs: serve the repo, open tools/voice/units.html in headless Chrome (silent: the
page sets window.__BUDDY_SILENT__ and loads the app with ?silent=1; Chrome runs with --mute-audio --disable-audio-output),
and save what the page POSTs to tools/voice/units.json.

Run:  python3 tools/voice/collect.py        (then tools/voice/make.py records the clips that are missing)
      python3 tools/voice/collect.py --page "tools/voice/units.html?lang=es" --out tools/voice/units-es.json
                                            (3.1.0: the Spanish lines, for Estrella: make.py --lang es)
      python3 tools/voice/collect.py --page "tools/voice/units.html?only=kids" --merge tools/voice/units.json
                                            (3.1.0: the English kids stories added to Asteria's list; the 3.0 entries stay
                                            as they are, a unit the kids lines share gets "kids" in its sources)
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
    ap.add_argument("--merge", help="add the page's units to this units file instead (keep its entries, add the new ones)")
    ap.add_argument("--wait", type=int, default=180, help="seconds to wait for the page's answer")
    a = ap.parse_args()
    OUT = os.path.abspath(a.out)
    merge_into = os.path.abspath(a.merge) if a.merge else None
    if merge_into:
        OUT = merge_into + ".new.json"
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
    ok = got.wait(a.wait)
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
    if "units" in data and merge_into:
        old = json.load(open(merge_into, encoding="utf-8"))
        have = {u[0]: u for u in old["units"]}
        added, tagged, clash = 0, 0, list(data.get("clashes", []))
        for k, t, src, *_ in data["units"]:
            u = have.get(k)
            if u is None:
                old["units"].append([k, t, src])
                have[k] = old["units"][-1]
                added += 1
            elif u[1] != t:
                clash.append([u[1], t])
            else:
                srcs = u[2].split(",")
                for s_ in src.split(","):
                    if s_ not in srcs:
                        srcs.append(s_)
                        tagged += 1
                u[2] = ",".join(srcs)
        old["clashes"] = old.get("clashes", []) + clash
        old.setdefault("merged", []).append({"when": data.get("when"), "page": a.page, "added": added})
        with open(merge_into, "w", encoding="utf-8") as f:
            json.dump(old, f, ensure_ascii=False, indent=0)
        os.unlink(OUT)
        print(f"merged into {os.path.relpath(merge_into, REPO)}: {added} new units, {tagged} sources added, clashes: {len(clash)}")
        if clash:
            sys.exit(1)
    elif "units" in data:
        print(f"saved {len(data['units'])} units to {os.path.relpath(OUT, REPO)}; clashes: {len(data['clashes'])}")
    else:
        print(data.get("title", ""))
        for r in data.get("rows", []):
            print("  " + r)
        if "ALL PASS" not in data.get("title", ""):
            sys.exit(1)


if __name__ == "__main__":
    main()
