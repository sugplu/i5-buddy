#!/usr/bin/env python3
"""Run every automated test page in headless Chrome and print a pass/fail table.

Serves the repo root itself on a free port chosen at start (see serve()), so several runs can go at once.
  --root FOLDER   serve and test another folder (a built site); its tools/ files, or this repo's when it has none
To use a server that is already running instead:
  --base http://127.0.0.1:8765/tools/   (python3 -m http.server 8765 --bind 127.0.0.1, from the repo root)
Run:  python3 tools/run_tests.py [--quick] [--only NAME] [-j 4] [--root FOLDER] [--base URL]

Silent: Chrome runs with --headless=new --mute-audio --disable-audio-output, every test page sets
window.__BUDDY_SILENT__ and loads the app with ?silent=1, and js/voice.js then uses a fake speech engine and a silent
chime. The run refuses to start when js/voice.js or a test page lacks that hook (see silent_guard()). After a first run,
check: pmset -g assertions | grep -A2 BuiltInSpeakerDevice (no Chrome or test PID may be listed).

A test passes when its page title, or a console line, says ALL PASS / PASS and nothing says FAIL.
Scenario lists come from the headers of each tools/test-*.html page.
"""
import concurrent.futures as cf, functools, http.server, os, re, shutil, socketserver, subprocess, sys, tempfile, threading, time

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = REPO  # the folder served and tested; --root changes it
BASE = None  # set in main()


def serve():
    """Serve ROOT like `python3 -m http.server`, but with a listen backlog several headless Chromes can share.
    socketserver's default backlog is 5: with two browsers loading the app at once, macOS resets the extra
    connections (net::ERR_CONNECTION_RESET), main.js or one of its imports never arrives, and a page that waits
    for the app never prints a result (UNKNOWN)."""
    class Server(http.server.ThreadingHTTPServer):
        request_queue_size = 128

        def server_bind(self):
            # http.server's own server_bind asks socket.getfqdn() for a host name, a reverse DNS lookup that can hang
            # for minutes on a Mac whose resolver is stalled; nothing here needs the name.
            socketserver.TCPServer.server_bind(self)
            self.server_name, self.server_port = "127.0.0.1", self.server_address[1]

        def handle_error(self, request, client_address):
            if not isinstance(sys.exc_info()[1], ConnectionError):  # a browser hanging up mid-file is normal
                super().handle_error(request, client_address)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def translate_path(self, path):
            # --root: a folder without its own test pages or fixtures uses this repo's tools/ files
            p = super().translate_path(path)
            if ROOT != REPO and not os.path.exists(p):
                rel = os.path.relpath(p, ROOT)
                if rel == "tools" or rel.startswith("tools" + os.sep):
                    return os.path.join(REPO, rel)
            return p

    srv = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}/tools/"


# (name, page+query, virtual time budget ms, window size, quick?)
SUITE = [
    ("geometry", "test.html", 15000, "500,800", True),
    # the natural voice (3.0): speech units, clip names, the clip player with fake clips (nothing fetched or heard)
    ("voice", "test-voice.html", 60000, "900,960", True),
    # (test-voice.html?real=1 decodes the real clips: it needs real time, not this runner's virtual time, so it runs with
    #  python3 tools/voice/collect.py --page "tools/test-voice.html?real=1" --out /tmp/voice-real.json)
    ("e2e drive", "e2e.html", 120000, "900,960", True),
    ("trip auto", "test-trip.html?s=auto", 120000, "1100,960", True),
    ("listen selftest", "test-listen.html?state=selftest", 250000, "1100,960", True),
    ("play check", "test-play.html?s=check", 60000, "900,960", True),
    ("play speech", "test-play.html?s=speech", 120000, "900,960", False),
    # cluster drives 734 -> 746.2 in 0.05-mile steps, 500 ms each: about 125 s of page time before it reports
    ("play cluster", "test-play.html?s=cluster", 180000, "900,960", False),
    ("map whole", "test-map.html?scene=whole", 30000, "900,960", True),
    ("map zoom", "test-map.html?scene=zoom", 30000, "900,960", False),
    ("map place", "test-map.html?scene=place", 30000, "900,960", True),
    ("map follow", "test-map.html?scene=follow", 30000, "900,960", False),
    ("map gesture", "test-map.html?scene=gesture", 30000, "900,960", False),
    ("map stamps", "test-map.html?scene=stamps", 30000, "900,960", False),
    ("map light", "test-map.html?scene=whole&theme=light", 30000, "900,960", False),
    ("nav search", "test-nav.html?s=search", 90000, "500,900", True),
    ("nav route", "test-nav.html?s=route", 90000, "500,900", True),
    ("nav drive", "test-nav.html?s=drive", 200000, "500,900", True),
    ("share", "test-share.html", 40000, "500,900", True),
    ("missions", "test-missions.html", 60000, "500,900", True),
    # "Get the iPhone app" (welcome card, About) by browser and inside the iPhone app; get/index.html; tags and sw.js
    ("get app", "test-getapp.html?s=app", 150000, "500,900", True),
    ("get page", "test-getapp.html?s=get", 60000, "500,900", True),
    ("get site", "test-getapp.html?s=site", 40000, "500,900", True),
    ("feedback", "test-feedback.html", 60000, "500,900", True),
    ("feedback light", "test-feedback.html?theme=light", 60000, "500,900", False),
    ("roadahead", "test-roadahead.html", 90000, "500,900", True),
    ("roadahead light", "test-roadahead.html?theme=light", 90000, "500,900", False),
    ("ride art", "test-ride.html?scene=art", 30000, "900,960", True),
    ("ride picker", "test-ride.html?scene=picker", 40000, "900,960", True),
    ("ride invite", "test-ride.html?scene=invite", 60000, "900,960", False),
    ("ride moving", "test-ride.html?scene=moving", 60000, "900,960", False),
    ("ride glance", "test-ride.html?scene=glance&w=375&h=780", 60000, "900,960", False),
    ("ride motion", "test-ride.html?scene=motion", 40000, "900,960", False),
    ("ride passport", "test-ride.html?scene=passport", 40000, "900,960", False),
    ("ride light", "test-ride.html?scene=picker&theme=light", 40000, "900,960", False),
    ("map ride", "test-map.html?scene=ride", 30000, "900,960", True),
    ("map ride light", "test-map.html?scene=ride&theme=light", 30000, "900,960", False),
    ("map 3d", "test-map.html?scene=threed", 90000, "900,960", True),
    ("map fake routeonly", "test-map.html?scene=fake&variant=routeonly", 30000, "900,960", False),
    ("live unit", "test-live.html?s=unit", 30000, "900,960", True),
    ("live mock", "test-live.html?s=mock", 60000, "900,960", True),
    ("live traffic", "test-live.html?s=traffic", 800000, "900,960", False),
    ("live traffic old", "test-live.html?s=trafficold", 1500000, "900,960", False),
    ("live speech", "test-live.html?s=speech", 300000, "900,960", False),
    ("live chains", "test-live.html?s=chains", 120000, "900,960", False),
    ("live toggle", "test-live.html?s=toggle", 120000, "900,960", False),
    ("live fail", "test-live.html?s=fail", 60000, "900,960", False),
    ("live nopos", "test-live.html?s=nopos", 60000, "900,960", False),
    ("live north", "test-live.html?s=north", 60000, "900,960", False),
    ("live la", "test-live.html?s=la", 60000, "900,960", False),
    ("live end", "test-live.html?s=end", 150000, "900,960", False),
    ("live south", "test-live.html?s=south", 60000, "900,960", False),
]

def silent_guard(tests):
    """The app must never be heard while tests run: js/voice.js has the silent hook and every page sets the flag."""
    def find(rel):
        for base in (ROOT, REPO):
            p = os.path.join(base, rel)
            if os.path.exists(p):
                return p
        return None
    bad = []
    voice = find(os.path.join("js", "voice.js"))
    if not voice or "__BUDDY_SILENT__" not in open(voice, encoding="utf-8").read():
        bad.append("js/voice.js has no silent hook")
    for page in sorted({t[1].split("?")[0] for t in tests}):
        p = find(os.path.join("tools", page))
        if p and "__BUDDY_SILENT__" not in open(p, encoding="utf-8").read():
            bad.append(f"tools/{page} does not set window.__BUDDY_SILENT__")
    if bad:
        print("not silent, not running:\n  " + "\n  ".join(bad), file=sys.stderr)
        sys.exit(2)


FAIL_RE = re.compile(r"\b(FAILED|FAIL)\b")
PASS_RE = re.compile(r"\bALL PASS\b|\bPASS\b")


def run(test):
    name, page, budget, size, _ = test
    prof = tempfile.mkdtemp(prefix="i5test-")
    cmd = [CHROME, "--headless=new", "--mute-audio", "--disable-audio-output", "--disable-gpu", f"--user-data-dir={prof}",
           "--enable-logging=stderr", "--v=0",
           "--autoplay-policy=no-user-gesture-required", f"--window-size={size}", f"--virtual-time-budget={budget}",
           # Hermetic: every outside host fails at once. Camera <img>s point at real Caltrans servers, and headless
           # Chrome's virtual clock stops while a download is pending, so a slow connection used to time tests out.
           "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
           "--dump-dom", BASE + page]
    t0 = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=max(120, budget / 1000 * 2 + 60))
        dom, err = p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return name, "TIMEOUT", "", time.time() - t0
    finally:
        # each page gets a fresh Chrome profile (about 6 MB); a full run left 40 of them behind
        shutil.rmtree(prof, ignore_errors=True)
    title = (re.search(r"<title>(.*?)</title>", dom, re.S) or [None, ""])[1].strip()
    console = [m for m in re.findall(r'CONSOLE[^"]*"(.*?)", source', err)]
    errors = [c for c in console if re.search(r"Uncaught|TypeError|ReferenceError|SyntaxError", c)]
    finals = [c for c in console if re.search(r"ALL PASS|FAILED|\bFAIL\b", c)]
    bar = (re.search(r'<div id="bar"[^>]*>(.*?)</div>', dom, re.S) or [None, ""])[1]
    text = " | ".join(x for x in [title, bar] + finals[-3:] if x)
    if errors:
        verdict = "ERROR"
    elif re.search(r"FAILED|\bFAIL\b", title + " " + bar) or any(re.search(r"FAILED|^\S*\s*FAIL\b|\bFAIL ", c) for c in finals):
        verdict = "FAIL"
    elif re.search(r"ALL PASS|\bPASS\b", title + " " + bar) or any("ALL PASS" in c or re.search(r"\bPASS\b", c) for c in finals):
        verdict = "PASS"
    else:
        verdict = "UNKNOWN"
    detail = text if verdict != "ERROR" else "; ".join(errors[:2])
    return name, verdict, detail[:220], time.time() - t0


def main():
    global BASE, ROOT
    quick = "--quick" in sys.argv
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    jobs = int(sys.argv[sys.argv.index("-j") + 1]) if "-j" in sys.argv else 4
    if "--root" in sys.argv:
        ROOT = os.path.abspath(sys.argv[sys.argv.index("--root") + 1])
        if not os.path.isfile(os.path.join(ROOT, "index.html")):
            sys.exit(f"--root {ROOT}: no index.html there")
    tests = [t for t in SUITE if (not quick or t[4]) and (not only or only in t[0])]
    silent_guard(tests)
    BASE = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else serve()
    results = {}
    with cf.ThreadPoolExecutor(jobs) as ex:
        for t, (name, verdict, detail, secs) in zip(tests, ex.map(run, tests)):
            results[name] = (verdict, detail, secs)
            print(f"{verdict:8} {name:18} {secs:5.0f}s  {detail}", flush=True)
    # Headless virtual time is sensitive to CPU load: rerun anything that didn't pass, one at a time.
    again = [t for t in tests if results[t[0]][0] != "PASS"]
    if again:
        print(f"\nretrying {len(again)} one at a time:")
        for t in again:
            name, verdict, detail, secs = run(t)
            results[name] = (verdict + ("" if verdict != "PASS" else "*"), detail, secs)
            print(f"{verdict:8} {name:18} {secs:5.0f}s  {detail}", flush=True)
    bad = sum(1 for v in results.values() if not v[0].startswith("PASS"))
    print(f"\n{len(tests) - bad}/{len(tests)} passed" + (" (* = passed on retry)" if any(v[0] == "PASS*" for v in results.values()) else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
