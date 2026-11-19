"""Tell Bing (and the other IndexNow engines: Yandex, Seznam, Naver; Bing feeds DuckDuckGo, Yahoo and ChatGPT search) that
the site's pages exist or changed. No account needed: the key file at the site root proves the site is ours.
    python3 -I tools/indexnow.py            every URL in sitemap.xml
    python3 -I tools/indexnow.py URL ...    just these
Run it after a release that adds or changes pages. Added 2026-11-18 (I-5 Buddy "more drivers")."""
import glob, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = "i5.dominares.org"
keys = [os.path.basename(p)[:-4] for p in glob.glob(os.path.join(ROOT, "*.txt")) if re.fullmatch(r"[0-9a-f]{32}\.txt", os.path.basename(p))]
if len(keys) != 1:
    sys.exit("expected exactly one IndexNow key file (32 hex characters + .txt) at the site root")
key = keys[0]
urls = sys.argv[1:] or re.findall(r"<loc>([^<]+)</loc>", open(os.path.join(ROOT, "sitemap.xml"), encoding="utf-8").read())
body = json.dumps({"host": HOST, "key": key, "keyLocation": "https://%s/%s.txt" % (HOST, key), "urlList": urls}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, method="POST",
                             headers={"Content-Type": "application/json; charset=utf-8"})
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        print("IndexNow: HTTP %d for %d URLs (200/202 = received)" % (r.status, len(urls)))
except urllib.error.HTTPError as e:
    sys.exit("IndexNow refused: HTTP %d %s (403 = key file not live yet, 422 = a URL isn't on %s)" % (e.code, e.read()[:200], HOST))
