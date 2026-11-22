#!/usr/bin/env python3
"""Check recorded clips without playing them (3.1.0): decode each clip, send it to Whisper (Workers AI speech-to-text,
through the local sampler's /asr), and compare what it heard with what the voice was sent. A clip that comes back too
different, or that is far too long or too short for its words (a slurred, stalled or cut-off take), is recorded again,
up to --retake times; the better-heard take is kept. Nothing is ever played on this Mac.

    ~/Dominares/tts/.venv/bin/python tools/voice/check.py --lang es --ledger LEDGER --report OUT.json [--keys FILE]
        [--retake 2] [--budget 35] [--jobs 8] [--sample N]

Short clips (a number, an exit letter, "hacia") are checked in batches: up to 12 of them joined with 0.8 s of silence
in one request, so the recognizer hears words in context (alone, a one-word clip often comes back as "Gracias."), and
each clip's words are found in what it heard. The report lists every clip with its score; tools/voice/whisper-<voice>.json
keeps the summary and the clips that still differ after the re-takes (most are English names the Spanish recognizer
writes its own way, which the clip itself may say well).
"""
import argparse, difflib, io, json, os, re, statistics, subprocess, sys, tempfile, threading, time, unicodedata, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make  # noqa: E402

ASR_URL = make.AURA_URL + "asr?lang="
SHORT_WORDS = 3          # clips with at most this many words are checked in batches
BATCH = 12
GAP_S = 0.8


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def words_of(text, lang, heard=False):
    """Lower-case words without punctuation or accents; numbers in words; Spanish spelling folded so that letters that sound
    alike match (b/v, s/z/soft c, ll/y, silent h), since only the sound is being checked. heard: Whisper's own writing,
    which may group thousands with a period ("300.000") or a space."""
    s = str(text)
    if heard:
        s = re.sub(r"\b(\d{1,3})[. ](\d{3})\b", r"\1,\2", s)
    if lang == "es":
        from spoken_es import spoken_es
        s = spoken_es(s)
    s = strip_accents(s.lower())
    s = re.sub(r"[^a-z0-9ñ' ]+", " ", s.replace("-", " "))
    out = []
    for w in s.split():
        w = w.strip("'")
        if not w:
            continue
        if lang == "es":
            w = w.replace("v", "b").replace("z", "s").replace("ll", "y").replace("h", "")
            w = re.sub(r"c(?=[ei])", "s", w)
            w = w.replace("qu", "k").replace("c", "k").replace("ñ", "n")
            if not w:
                continue
        out.append(w)
    return out


def wer(ref, hyp):
    r, h = ref, hyp
    if not r:
        return 0.0 if not h else 1.0
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / len(r)


def score(ref_words, heard_words):
    """(word error, character similarity) of what was heard against what was sent."""
    return wer(ref_words, heard_words), difflib.SequenceMatcher(None, " ".join(ref_words), " ".join(heard_words)).ratio()


def gap_of(data):
    """The longest pause inside a clip (seconds below 35 dB under its loud frames), from its WAV bytes."""
    import numpy as np, soundfile as sf
    a, sr = sf.read(io.BytesIO(data), dtype="float32")
    fr = max(1, int(sr * 0.01))
    n = len(a) // fr
    if n < 3:
        return 0.0
    db = 20 * np.log10(np.maximum(np.sqrt((a[: n * fr].reshape(n, fr).astype("float64") ** 2).mean(axis=1)), 1e-9))
    top = float(np.percentile(db, 95))
    loud = np.where(db > top - 35)[0]
    if len(loud) < 2:
        return 0.0
    return float(np.max(np.diff(loud)) - 1) * 0.01


def decode(path, rate=16000):
    """The clip as 16-bit mono WAV bytes at rate (afconvert, macOS), and its length in seconds."""
    fd, wav = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{rate}", "-c", "1", path, wav], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        data = open(wav, "rb").read()
    finally:
        os.unlink(wav)
    import soundfile as sf
    info = sf.info(io.BytesIO(data))
    return data, info.frames / info.samplerate


def join_wavs(parts, rate=16000):
    """Clips joined with GAP_S of silence (and a little before and after) into one WAV; returns (bytes, [start, end] s)."""
    import numpy as np, soundfile as sf
    gap = np.zeros(int(rate * GAP_S), dtype="float32")
    chunks, spans, t = [gap], [], GAP_S
    for data in parts:
        a, sr = sf.read(io.BytesIO(data), dtype="float32")
        chunks.append(a)
        spans.append((t, t + len(a) / sr))
        t += len(a) / sr + GAP_S
        chunks.append(gap)
    buf = io.BytesIO()
    sf.write(buf, np.concatenate(chunks), rate, format="WAV", subtype="PCM_16")
    return buf.getvalue(), spans


def asr(wav, lang, seconds):
    err = None
    for wait in (0, 3, 8, 20):
        if wait:
            time.sleep(wait)
        try:
            req = urllib.request.Request(ASR_URL + lang, data=wav, method="POST", headers={"content-type": "audio/wav"})
            with urllib.request.urlopen(req, timeout=180) as r:
                out = json.loads(r.read())
            make._ledger({"kind": "asr", "seconds": round(seconds, 2), "ok": True})
            return out
        except Exception as e:  # noqa: BLE001
            err = e
    make._ledger({"kind": "asr", "seconds": round(seconds, 2), "ok": False, "err": str(err)[:200]})
    raise err


def digits_read(heard):
    """Whisper heard a number as single digits ("one eight six seven", "three, two")."""
    w = r"(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)"
    return bool(re.search(rf"\b{w}[ ,]+{w}\b", str(heard).lower()))


def heard_text(out):
    return str((out or {}).get("text") or "").strip()


class Checker:
    def __init__(self, lang, vdir, units, report):
        self.lang, self.vdir, self.units, self.report = lang, vdir, units, report
        self.lock = threading.Lock()
        self.rates = []          # seconds per spoken character of long clips, for the length check

    def path(self, k):
        return os.path.join(self.vdir, k[:2], k + ".m4a")

    def ref(self, k):
        return words_of(self.units[k], self.lang)

    def judge(self, k, heard, seconds, gap=0.0):
        """A clip's verdict: {heard, wer, sim, seconds, gap, ok, why}. A lone letter (an exit's "B.", a trivia answer's
        "B:") is judged by its length only: the recognizer writes a letter name as the letter, or not at all."""
        ref, got = self.ref(k), words_of(heard, self.lang, heard=True)
        w, sim = score(ref, got)
        n = len(ref)
        sp = self.spoken_len(k)
        letter = bool(re.fullmatch(r"[A-H][.:]?", self.units[k].strip()))
        why = []
        if letter:
            pass
        elif n >= 4 and w > 0.3 and sim < 0.85:
            why.append(f"heard differently (word error {w:.2f})")
        elif n < 4 and w > 0.5 and sim < 0.7:
            why.append(f"heard differently (word error {w:.2f})")
        if not got and n and not letter:
            why.append("nothing heard")
        med = self.median_rate()
        if med and sp >= 25:
            rate = seconds / sp
            if rate > med * 1.9:
                why.append(f"too long for its words ({seconds:.1f} s, {rate / med:.1f} times the usual pace)")
            elif rate < med * 0.5:
                why.append(f"too short for its words ({seconds:.1f} s)")
        elif sp < 25:
            if seconds > 0.5 + sp * 0.12:
                why.append(f"too long for its words ({seconds:.1f} s)")
            elif seconds < max(0.15, sp * 0.03):
                why.append(f"too short for its words ({seconds:.2f} s)")
        if gap > 1.0:
            why.append(f"a {gap:.1f} s pause inside")
        return {"heard": heard, "wer": round(w, 3), "sim": round(sim, 3), "seconds": round(seconds, 2), "gap": round(gap, 2),
                "ok": not why, "why": why}

    def spoken_len(self, k):
        """The length of what the voice says for a clip, in characters: English digits (not written out for Asteria) count
        about as long as their words."""
        sp = make.spoken_for(self.units[k])
        return len(re.sub(r"\d", "xxxxx", sp)) if self.lang == "en" else len(sp)

    def median_rate(self):
        with self.lock:
            return statistics.median(self.rates) if len(self.rates) >= 30 else None

    def check_one(self, k, path=None):
        data, sec = decode(path or self.path(k))
        out = asr(data, self.lang, sec)
        sp = self.spoken_len(k)
        if sp >= 25:
            with self.lock:
                self.rates.append(sec / sp)
        return self.judge(k, heard_text(out), sec, gap_of(data))

    def check_batch(self, keys, paths=None):
        """Short clips in one request: each clip's words are looked for, in order, in what was heard."""
        datas, secs, gaps = [], [], []
        for i, k in enumerate(keys):
            d, s = decode((paths or {}).get(k) or self.path(k))
            datas.append(d)
            secs.append(s)
            gaps.append(gap_of(d))
        wav, spans = join_wavs(datas)
        total = spans[-1][1] + GAP_S if spans else 0
        out = asr(wav, self.lang, total)
        heard_all = words_of(heard_text(out), self.lang, heard=True)
        res = {}
        # align the expected words of the whole batch with what was heard, then score each clip on its own stretch
        exp, owner = [], []
        for i, k in enumerate(keys):
            for w in self.ref(k):
                exp.append(w)
                owner.append(i)
        sm = difflib.SequenceMatcher(None, exp, heard_all, autojunk=False)
        got = [[] for _ in keys]
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                for a, b in zip(range(i1, i2), range(j1, j2)):
                    got[owner[a]].append(heard_all[b])
            elif tag == "replace":
                # the heard words of a replaced stretch go to the clips of that stretch, in proportion
                span = list(range(i1, i2))
                for n, b in enumerate(range(j1, j2)):
                    got[owner[span[min(len(span) - 1, n * len(span) // max(1, j2 - j1))]]].append(heard_all[b])
        for i, k in enumerate(keys):
            r = self.judge(k, " ".join(got[i]), secs[i], gaps[i])
            r["batch"] = heard_text(out)
            res[k] = r
        return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=sorted(make.VOICES), default="es")
    ap.add_argument("--ledger", required=True)
    ap.add_argument("--report", required=True, help="every clip's result (JSON), kept between runs")
    ap.add_argument("--keys", help="only these clips (one key per line); default: every clip of the language's unit list")
    ap.add_argument("--retake", type=int, default=2, help="record a clip that fails again up to this many times")
    ap.add_argument("--budget", type=float, default=35.0, help="dollars: no new take once the ledger would pass this")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--sample", type=int, default=0, help="check only N clips (a trial)")
    ap.add_argument("--recheck", action="store_true", help="check again clips the report already has")
    ap.add_argument("--summary", help="write the totals and every clip that still differs here (for the repo)")
    a = ap.parse_args()
    make.setup(a.lang, a.ledger)
    data = json.load(open(os.path.join(HERE, make.VOICES[a.lang]["units"]), encoding="utf-8"))
    units = {k: t for k, t, *_ in data["units"]}
    vdir = os.path.join(make.REPO, "voice", make.VOICE_ID)
    C = Checker(a.lang, vdir, units, a.report)
    report = json.load(open(a.report, encoding="utf-8")) if os.path.exists(a.report) else {}
    keys = [k for k in (open(a.keys).read().split() if a.keys else units) if k in units and os.path.exists(C.path(k))]
    if not a.recheck:
        keys = [k for k in keys if k not in report]
    if a.sample:
        keys = keys[: a.sample]
    long_keys = [k for k in keys if len(C.ref(k)) > SHORT_WORDS]
    short_keys = [k for k in keys if len(C.ref(k)) <= SHORT_WORDS]
    print(f"{len(keys)} clips to check ({len(long_keys)} one by one, {len(short_keys)} in batches of {BATCH})", flush=True)
    save_lock = threading.Lock()
    done = [0]

    def save():
        with save_lock:
            tmp = a.report + ".part"
            json.dump(report, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
            os.replace(tmp, a.report)

    def put(k, r, take=0):
        r["take"] = take
        r["text"] = units[k]
        with save_lock:
            report[k] = r
            done[0] += 1
            if done[0] % 250 == 0:
                print(f"  checked {done[0]}, {sum(1 for x in report.values() if not x['ok'])} not ok so far", flush=True)

    # long clips first (they set the usual pace), one request each
    def one(k):
        try:
            put(k, C.check_one(k))
        except Exception as e:  # noqa: BLE001
            put(k, {"ok": False, "why": [f"check failed: {e}"], "heard": "", "wer": 1.0, "sim": 0.0, "seconds": 0})
    with ThreadPoolExecutor(a.jobs) as pool:
        list(pool.map(one, long_keys))
    save()

    def batch(ks):
        try:
            for k, r in C.check_batch(ks).items():
                put(k, r)
        except Exception as e:  # noqa: BLE001
            for k in ks:
                put(k, {"ok": False, "why": [f"check failed: {e}"], "heard": "", "wer": 1.0, "sim": 0.0, "seconds": 0})
    with ThreadPoolExecutor(a.jobs) as pool:
        list(pool.map(batch, [short_keys[i:i + BATCH] for i in range(0, len(short_keys), BATCH)]))
    save()

    # re-takes: a new take for each clip that failed; the better-heard take is kept (word error, then similarity)
    for rnd in range(1, a.retake + 1):
        bad = [k for k in keys if k in report and not report[k]["ok"] and report[k].get("take", 0) < rnd and "check failed" not in " ".join(report[k]["why"])]
        if not bad:
            break
        cost = sum(len(make.spoken_for(units[k])) for k in bad) / 1000 * make.PRICE_PER_1K
        spent = make.ledger_spend(a.ledger)["usd"]
        print(f"re-take {rnd}: {len(bad)} clips, about ${cost:.2f} (spent so far ${spent:.2f})", flush=True)
        if spent + cost > a.budget:
            print(f"STOP: the re-takes would pass the ${a.budget:.2f} budget", flush=True)
            break
        tmpdir = tempfile.mkdtemp(prefix="retake-")

        def retake(k):
            out = os.path.join(tmpdir, k + ".m4a")
            say = None
            if a.lang == "en" and re.search(r"\d", units[k]) and (rnd == a.retake or digits_read(report[k].get("heard", ""))):
                say = make.words_en(make.spoken_for(units[k]))     # a number read digit by digit: say it in words
            try:
                make.render_clip(units[k], out, purpose=f"retake{rnd}", say=say)
                return k, out
            except Exception as e:  # noqa: BLE001
                return k, None
        with ThreadPoolExecutor(a.jobs) as pool:
            takes = dict(pool.map(retake, bad))
        new = {}
        lk = [k for k in bad if takes.get(k) and len(C.ref(k)) > SHORT_WORDS]
        sk = [k for k in bad if takes.get(k) and len(C.ref(k)) <= SHORT_WORDS]

        def one2(k):
            try:
                new[k] = C.check_one(k, takes[k])
            except Exception as e:  # noqa: BLE001
                new[k] = None
        with ThreadPoolExecutor(a.jobs) as pool:
            list(pool.map(one2, lk))

        def batch2(ks):
            try:
                new.update(C.check_batch(ks, {k: takes[k] for k in ks}))
            except Exception:  # noqa: BLE001
                pass
        with ThreadPoolExecutor(a.jobs) as pool:
            list(pool.map(batch2, [sk[i:i + BATCH] for i in range(0, len(sk), BATCH)]))
        kept = 0
        for k in bad:
            old, nw = report[k], new.get(k)
            if nw is not None and (nw["ok"] or (nw["wer"], -nw["sim"]) < (old["wer"], -old["sim"])):
                os.replace(takes[k], C.path(k))
                nw["take"], nw["text"] = rnd, units[k]
                nw["before"] = {"heard": old["heard"], "wer": old["wer"], "why": old["why"]}
                report[k] = nw
                kept += 1
            else:
                old["take"] = rnd
                old.setdefault("retakes", []).append(nw and {"heard": nw["heard"], "wer": nw["wer"], "why": nw["why"]})
        print(f"  kept {kept} new takes; {sum(1 for k in bad if not report[k]['ok'])} still not ok", flush=True)
        save()
    bad = [k for k in keys if not report[k]["ok"]]
    sp = make.ledger_spend(a.ledger)
    print(f"done: {len(keys)} checked, {len(bad)} still not ok; ledger ${sp['usd']:.2f} ({sp['chars']:,} characters, "
          f"{sp['asr_seconds'] / 60:.0f} min of Whisper)", flush=True)
    if a.summary:
        allk = [k for k in (open(a.keys).read().split() if a.keys else units) if k in report]
        retaken = [k for k in allk if report[k].get("take", 0) > 0]
        fixed = [k for k in retaken if report[k]["ok"]]
        out = {
            "voice": make.VOICE_ID, "lang": a.lang, "when": time.strftime("%Y-%m-%d %H:%M"),
            "how": "every clip decoded (afconvert) and heard by Whisper large v3 turbo on Workers AI, never played; short clips in "
                   "batches of 12 with 0.8 s between them; a clip heard differently (word error over 0.3 and similarity under 0.85; "
                   "short ones 0.5 / 0.7), far too long or short for its words, or with a pause over 1 s inside was recorded again "
                   "up to twice and the better-heard take kept",
            "clips": len(allk), "seconds": round(sum(report[k].get("seconds") or 0 for k in allk)),
            "retaken": len(retaken), "fixed_by_retake": len(fixed), "still_differ": len(allk) - sum(1 for k in allk if report[k]["ok"]),
            "word_error_mean": round(statistics.mean(report[k]["wer"] for k in allk), 4) if allk else None,
            "differ": [{"key": k, "text": report[k]["text"], "heard": report[k]["heard"], "wer": report[k]["wer"], "why": report[k]["why"],
                        "takes": 1 + len(report[k].get("retakes", [])) + (1 if report[k].get("before") else 0)}
                       for k in allk if not report[k]["ok"]],
        }
        json.dump(out, open(a.summary, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"summary: {a.summary}", flush=True)


if __name__ == "__main__":
    main()
