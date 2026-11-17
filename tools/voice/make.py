#!/usr/bin/env python3
"""Record the natural voice's clips: every unit in tools/voice/units.json (made by collect.py) that has no clip yet.

Two engines (Joseph picked the voice by ear, 2026-11-17: Aura-2 "asteria"):
  --engine aura    (default) Deepgram Aura-2 on Dominares' Cloudflare Workers AI, through the local sampler
                   (scratchpad tts-sampler: `npx wrangler@4.160.0 dev --port 8790`, an AI binding, never deployed).
                   About $0.03 per 1,000 characters, once; the clips are then ours to play for free.
  --engine kokoro  the open local model (Kokoro-82M, Apache-2.0; ~/Dominares/tts, see setup.sh there), voice af_heart.
Runs on the Pro:
    ~/Dominares/tts/.venv/bin/python tools/voice/make.py [--engine aura] [--jobs 6] [--only N] [--force]
Writes voice/<id>/<k[:2]>/<k>.m4a (AAC, 24 kHz mono) and voice/<id>/index.json:
    {"v": 1, "voice": "heart", "n": <clips>, "bytes": <total>, "keys": "<14 hex digits per clip, back to back>"}
The display text is what the app shows and the clip's name; spoken() rewrites it only for the ear (freeway numbers,
years, a few abbreviations, and names an English voice gets wrong). Silent: nothing is played, ever.
"""
import argparse, json, multiprocessing as mp, os, re, subprocess, sys, tempfile, time

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TTS = os.path.expanduser("~/Dominares/tts")
VOICE_ID, KOKORO_VOICE, SPEED = "asteria", "af_heart", 1.0
AURA_URL, AURA_SPEAKER = "http://127.0.0.1:8790/", "asteria"

# Names an English voice says wrong, spelled the way Californians say them (whole words, case-sensitive).
SAY = {
    "San Joaquin": "San Wah-keen", "Joaquin": "Wah-keen", "Tulare": "Too-lair-ee", "Panoche": "Pa-no-chee",
    "Pacoima": "Pa-coy-ma", "Otay": "Oh-tie", "Kumeyaay": "Koo-meh-yai", "Ohlone": "Oh-lo-nee", "Maidu": "My-doo",
    "Lemoore": "Luh-moor", "Pacheco": "Pa-cheh-co", "Nisenan": "Nee-seh-nan", "Mokelumne": "Mo-kull-uh-mee",
    "Cosumnes": "Ko-sum-ness", "Tuolumne": "Too-all-uh-mee", "Castaic": "Cass-take", "Lebec": "Luh-beck",
    "Tehachapi": "Tuh-hatch-uh-pee", "Yreka": "Why-ree-kuh", "YREKA": "Why-ree-kuh", "Coalinga": "Ko-uh-ling-guh",
    "Manteca": "Man-tee-kuh", "Lodi": "Lo-dye", "Ysidro": "Ee-see-dro", "Acjachemen": "Ahk-hah-cheh-men",
    "Kitanemuk": "Kit-uh-nem-uk", "Delano": "Duh-lay-no", "Artois": "Ar-toyss", "Mossbrae": "Moss-bray",
    "Luiseño": "Loo-ee-sayn-yo", "Luiseños": "Loo-ee-sayn-yos", "Payómkawichum": "Pah-yom-kah-wee-chum",
    "Junípero": "Hoo-nee-peh-ro", "Junipero": "Hoo-nee-peh-ro", "Purísima": "Poo-ree-see-ma",
    "Arcángel": "Ar-kahn-hel", "Lasuén": "Lah-soo-en", "Misión": "Mee-see-ohn", "Tejón": "Teh-hone",
    "Tejon": "Teh-hone", "Sylmar": "Sil-mar", "IOOF": "I O O F", "Sepulveda": "Seh-pul-veh-da",
    "Cajon": "Ka-hone", "Shastina": "Shas-tee-na", "Suisun": "Suh-soon",
}
SAY_RE = re.compile(r"\b(" + "|".join(sorted(map(re.escape, SAY), key=len, reverse=True)) + r")\b")
UNIT_AFTER = r"(?!\s*(?:feet|foot|ft|miles?|acres?|people|residents|cars|vehicles|trucks|tons|gallons|meters|students|workers|homes|beds|seats|years))"


def route_words(n):
    """405 -> "4 oh 5", 210 -> "2 10", 99 -> "99": how Californians say freeway and exit numbers."""
    n = int(n)
    if n < 100:
        return str(n)
    s = str(n)
    head, tail = s[:-2], s[-2:]
    return f"{head} oh {tail[1]}" if tail[0] == "0" else f"{head} {int(tail)}"


def year_words(m):
    y = int(m.group(1))
    suf = m.group(2) or ""
    if 2000 <= y <= 2009:
        return str(y) + suf
    a, b = divmod(y, 100)
    if b == 0:
        return f"{a} hundred" if not suf else f"{a} hundreds"
    return f"{a} oh {b}{suf}" if b < 10 else f"{a} {b}{suf}"


def spoken(t):
    s = t
    # a lone number is an exit number in a navigation prompt ("Take exit", "278", "B."): "two seventy-eight"
    m = re.fullmatch(r"(\d{1,3})(\.?)", s.strip())
    if m:
        return route_words(m.group(1)) + m.group(2)
    s = re.sub(r"\bWorld War II\b", "World War Two", s)
    s = re.sub(r"\bWorld War I\b", "World War One", s)
    s = re.sub(r"\b([A-Z]{1,3})&([A-Z]{1,3})\b", r"\1 and \2", s)          # PG&E, A&W
    s = s.replace("&", " and ")
    s = re.sub(r"\bSt\. (?=[A-Z])", "Saint ", s)
    s = re.sub(r"\bMt\. ", "Mount ", s)
    s = re.sub(r"\bFt\. ", "Fort ", s)
    s = re.sub(r"\bJr\.", "Junior", s)
    s = re.sub(r"\bSr\.", "Senior", s)
    s = re.sub(r"\bNo\. (?=\d)", "Number ", s)
    s = re.sub(r"\bHwy\.? ", "Highway ", s)
    # freeways and exits
    s = re.sub(r"\bI-(\d+)([NSEW]?)\b", lambda m: "I " + route_words(m.group(1)) + ({"N": " North", "S": " South", "E": " East", "W": " West"}.get(m.group(2), "")), s)
    s = re.sub(r"\bInterstate (\d+)\b", lambda m: "Interstate " + route_words(m.group(1)), s)
    s = re.sub(r"\b(?:US|U\.S\.)[- ](\d+)\b", lambda m: "U.S. " + route_words(m.group(1)), s)
    s = re.sub(r"\b(?:CA|SR)-(\d+)\b", lambda m: "Highway " + route_words(m.group(1)), s)
    s = re.sub(r"\b(Highway|Route|State Route) (\d+)\b", lambda m: m.group(1) + " " + route_words(m.group(2)), s)
    s = re.sub(r"\b([Ee]xits?) (\d+)([A-Z]?)\b", lambda m: f"{m.group(1)} {route_words(m.group(2))}{(' ' + m.group(3)) if m.group(3) else ''}", s)
    # years (four digits without a comma, not a quantity), and decades ("1870s")
    s = re.sub(r"(?<![\d,.$])\b(1[1-9]\d\d|20\d\d)(s?)\b" + UNIT_AFTER, year_words, s)
    s = SAY_RE.sub(lambda m: SAY[m.group(1)], s)
    return s


_k = None


def _init():
    global _k
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2
    so.inter_op_num_threads = 1
    sess = ort.InferenceSession(os.path.join(TTS, "models", "kokoro-v1.0.onnx"), so, providers=["CPUExecutionProvider"])
    _k = Kokoro.from_session(sess, os.path.join(TTS, "models", "voices-v1.0.bin"))


def _level(a):
    import numpy as np
    a = a.astype("float32")
    loud = a[np.abs(a) > 0.02]
    rms = float(np.sqrt(np.mean(loud ** 2))) if loud.size else 0.0
    if rms > 1e-4:
        a = a * (10 ** (-19 / 20) / rms)        # about -19 dBFS speech level
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    if peak > 0.89:
        a = a * (0.89 / peak)                     # never above -1 dBFS
    return a


def _trim(a, sr):
    """Cut silence at both ends, keeping 40 ms (Kokoro trims itself; Aura leaves a little)."""
    import numpy as np
    nz = np.where(np.abs(a) > 0.008)[0]
    if not len(nz):
        return a
    pad = int(sr * 0.04)
    return a[max(0, nz[0] - pad): min(len(a), nz[-1] + pad)]


def _aura(text):
    """One unit from Aura-2 through the local sampler: WAV bytes in, (samples, rate) out. Retries busy answers."""
    import io, time as _t, urllib.parse, urllib.request
    import soundfile as sf
    url = AURA_URL + "?" + urllib.parse.urlencode({"t": text, "s": AURA_SPEAKER, "enc": "linear16"})
    err = None
    for wait in (0, 2, 5, 12, 30):
        if wait:
            _t.sleep(wait)
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                data = r.read()
            if data[:4] != b"RIFF":
                raise RuntimeError("not audio: " + data[:120].decode("utf-8", "replace"))
            a, sr = sf.read(io.BytesIO(data), dtype="float32")
            return a, sr
        except Exception as e:  # noqa: BLE001 - retried, then reported
            err = e
    raise err


def _make_aura(job):
    key, text, out = job
    import soundfile as sf
    try:
        audio, sr = _aura(spoken(text))
        audio = _level(_trim(audio, sr))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        fd, wav = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            sf.write(wav, audio, sr, subtype="PCM_16")
            tmp = out + ".part.m4a"
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "40000", "-c", "1", wav, tmp], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            os.replace(tmp, out)
        finally:
            os.unlink(wav)
        return key, len(audio) / sr, None
    except Exception as e:  # noqa: BLE001 - report and go on
        return key, 0, f"{type(e).__name__}: {e}"


def _make(job):
    key, text, out = job
    import soundfile as sf
    try:
        audio, sr = _k.create(spoken(text), voice=KOKORO_VOICE, speed=SPEED, lang="en-us")
        audio = _level(audio)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        fd, wav = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            sf.write(wav, audio, sr, subtype="PCM_16")
            tmp = out + ".part.m4a"
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "40000", "-c", "1", wav, tmp], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            os.replace(tmp, out)
        finally:
            os.unlink(wav)
        return key, len(audio) / sr, None
    except Exception as e:  # noqa: BLE001 - report and go on
        return key, 0, f"{type(e).__name__}: {e}"


def write_index(vdir):
    keys, total = [], 0
    for sub in sorted(os.listdir(vdir)):
        d = os.path.join(vdir, sub)
        if len(sub) != 2 or not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.endswith(".m4a") and len(f) == 18:
                keys.append(f[:14])
                total += os.path.getsize(os.path.join(d, f))
    keys.sort()
    idx = {"v": 1, "voice": VOICE_ID, "model": "Deepgram Aura-2 (asteria), Cloudflare Workers AI", "n": len(keys), "bytes": total, "keys": "".join(keys)}
    with open(os.path.join(vdir, "index.json"), "w") as f:
        json.dump(idx, f, separators=(",", ":"))
    # stream.txt: the clips used only by the long stories (Tell me more, story time). The iPhone app leaves them out of
    # its bundle (i5-buddy-ios sync-web.sh) and downloads them from i5.dominares.org the first time (js/voice.js).
    try:
        units = json.load(open(os.path.join(REPO, "tools", "voice", "units.json"), encoding="utf-8"))["units"]
        have = set(keys)
        stream = sorted(k for k, t, src, *_ in units if k in have and set(str(src).split(",")) <= {"more", "story"})
        with open(os.path.join(vdir, "stream.txt"), "w") as f:
            f.write("\n".join(stream) + "\n")
    except (OSError, ValueError, KeyError):
        pass
    return len(keys), total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--engine", choices=["aura", "kokoro"], default="aura")
    ap.add_argument("--only", type=int, default=0, help="record at most N clips (a trial)")
    ap.add_argument("--force", action="store_true", help="record again even when the clip exists")
    ap.add_argument("--show", help="print the spoken form of this text and stop")
    a = ap.parse_args()
    if a.show:
        print(spoken(a.show))
        return
    data = json.load(open(os.path.join(REPO, "tools", "voice", "units.json"), encoding="utf-8"))
    vdir = os.path.join(REPO, "voice", VOICE_ID)
    jobs = []
    for k, t, *_ in data["units"]:
        out = os.path.join(vdir, k[:2], k + ".m4a")
        if a.force or not os.path.exists(out):
            jobs.append((k, t, out))
    jobs.sort(key=lambda j: -len(j[1]))         # long ones first, so the pool ends evenly
    if a.only:
        jobs = jobs[: a.only]
    print(f"{len(data['units'])} units, {len(jobs)} to record with {a.jobs} workers", flush=True)
    t0, secs, fails, done = time.time(), 0.0, [], 0
    if jobs and a.engine == "aura":
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(a.jobs) as pool:
            for key, dur, err in pool.map(_make_aura, jobs):
                done += 1
                secs += dur
                if err:
                    fails.append((key, err))
                if done % 200 == 0 or done == len(jobs):
                    el = time.time() - t0
                    print(f"  {done}/{len(jobs)} clips, {secs / 60:.0f} min of speech in {el / 60:.1f} min, {len(fails)} failed", flush=True)
    elif jobs:
        with mp.get_context("spawn").Pool(a.jobs, initializer=_init) as pool:
            for key, dur, err in pool.imap_unordered(_make, jobs, chunksize=4):
                done += 1
                secs += dur
                if err:
                    fails.append((key, err))
                if done % 200 == 0 or done == len(jobs):
                    el = time.time() - t0
                    print(f"  {done}/{len(jobs)} clips, {secs / 60:.0f} min of speech in {el / 60:.1f} min "
                          f"({secs / max(el, 1):.0f}x), {len(fails)} failed", flush=True)
    n, total = write_index(vdir)
    print(f"index: {n} clips, {total / 1048576:.1f} MB")
    for k, e in fails[:20]:
        print("  FAILED", k, e)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
