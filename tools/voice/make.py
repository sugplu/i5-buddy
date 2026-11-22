#!/usr/bin/env python3
"""Record the natural voice's clips: every unit in tools/voice/units.json (made by collect.py) that has no clip yet.

Two engines (Joseph picked the voice by ear, 2026-11-17: Aura-2 "asteria"):
  --engine aura    (default) Deepgram Aura-2 on Dominares' Cloudflare Workers AI, through the local sampler
                   (scratchpad tts-sampler: `npx wrangler@4.160.0 dev --port 8790`, an AI binding, never deployed).
                   About $0.03 per 1,000 characters, once; the clips are then ours to play for free.
  --engine kokoro  the open local model (Kokoro-82M, Apache-2.0; ~/Dominares/tts, see setup.sh there), voice af_heart.
Runs on the Pro:
    ~/Dominares/tts/.venv/bin/python tools/voice/make.py [--engine aura] [--jobs 6] [--only N] [--force] [--keys FILE]
Writes voice/<id>/<k[:2]>/<k>.m4a (AAC, 24 kHz mono) and voice/<id>/index.json:
    {"v": 1, "voice": "heart", "n": <clips>, "bytes": <total>, "keys": "<14 hex digits per clip, back to back>",
     "kids": "<the clips only Stories for kids uses, the same way>", "kidsBytes": <their total>}
The display text is what the app shows and the clip's name; spoken() rewrites it only for the ear (freeway numbers,
years, a few abbreviations, and names an English voice gets wrong). Silent: nothing is played, ever.

Spanish (3.1.0): --lang es records tools/voice/units-es.json (collect.py --page "tools/voice/units.html?lang=es") in the
voice Estrella (Aura-2 Spanish, speaker "estrella", the same local sampler: a Spanish speaker name picks
@cf/deepgram/aura-2-es) into voice/estrella/, with tools/voice/spoken_es.py's words for the ear (numbers, routes,
ordinals, times and amounts in Spanish words; names as written). Speech is levelled to the same -19 dBFS as Asteria; a
peak over -1 dBFS is held down by a 5 ms limiter instead of turning the whole clip down (as the samples Joseph picked from
were made), so clips joined into one line keep one loudness. English (Asteria, and its kids stories) is made exactly as
before. --ledger FILE logs every call's characters (the Cloudflare bill: $0.03 per 1,000) and --budget USD refuses to
start, or stops, before the ledger's total would pass it. tools/voice/check.py then checks every clip with Whisper.
"""
import argparse, json, multiprocessing as mp, os, re, subprocess, sys, tempfile, time

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TTS = os.path.expanduser("~/Dominares/tts")
VOICE_ID, KOKORO_VOICE, SPEED = "asteria", "af_heart", 1.0
AURA_URL, AURA_SPEAKER = "http://127.0.0.1:8790/", "asteria"
# the voice of each language (3.1.0): its folder, its Aura-2 speaker, its unit list, the model named in index.json
VOICES = {
    "en": {"id": "asteria", "speaker": "asteria", "units": "units.json", "model": "Deepgram Aura-2 (asteria), Cloudflare Workers AI"},
    "es": {"id": "estrella", "speaker": "estrella", "units": "units-es.json", "model": "Deepgram Aura-2 Spanish (estrella), Cloudflare Workers AI"},
}
LANG = "en"
PRICE_PER_1K = 0.03          # Aura-2 on Workers AI, dollars per 1,000 characters sent
LEDGER = None                # --ledger: one JSON line per call
_ledger_lock = None

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
# 2026-11-20 pronunciation sweep (credit program, tools/voice/say-sweep-2026-11-20.json): Claude Opus 5.5 read every
# capitalized word of the narration that is not in the English dictionary and named the ones an American voice is likely
# to say wrong; these are the high-confidence ones plus a few hand-picked medium ones. Clips whose spoken() text changed
# are listed there; re-record them with --keys (they still play the old reading until then).
SAY.update({
    "Aguaje": "Ah-gwah-heh", "Alejo": "Ah-leh-ho", "Almaden": "Al-muh-den", "Alpaugh": "Al-paw",
    "Arrillaga": "Ah-ree-yah-gah", "Asís": "Ah-sees", "Avenal": "Av-uh-nal", "Avila": "Ah-vee-la", "Baez": "Bye-ez",
    "Barbareño": "Bar-bah-rayn-yo", "Batiquitos": "Bah-tee-kee-tos", "Bautista": "Bow-tee-sta", "Beebe": "Bee-bee",
    "Benicia": "Buh-nee-sha", "Bosquejo": "Bos-keh-ho", "Brea": "Bray-uh",
    "Buellton": "Byool-tun", "Buttes": "Byoots", "Cabrillo": "Ka-bree-oh", "Carpinteria": "Car-pin-tuh-ree-uh",
    "Carquinez": "Kar-kee-ness", "Cañada": "Kahn-yah-da", "Cholame": "Show-lam", "Cielito": "See-eh-lee-to",
    "Colusa": "Ko-loo-suh", "Concepción": "Kon-sep-see-ohn", "DeHe": "Day-hay", "Dehe": "Day-hay",
    "Diegueños": "Dee-eh-gay-nyos", "Dieguito": "Dee-eh-gee-toe", "Doheny": "Doe-hee-nee", "Ecke": "Eck-ee",
    "Elijo": "Eh-lee-ho", "Estanislao": "Es-tah-nees-lah-oh", "Fages": "Fah-hess", "Feliz": "Fee-liz",
    "Fernandeño": "Fer-nan-dayn-yo", "Firebaugh": "Fire-baw", "Francisquito": "Fran-sis-kee-toe", "Friant": "Fry-ant",
    "Gabrieleño": "Gah-bree-el-ayn-yo", "Garcés": "Gar-sess", "Garzas": "Gar-sahs", "Guijarral": "Gee-ha-rahl",
    "Gustine": "Gus-teen", "Hedionda": "Eh-dee-on-da", "Hipólito": "Ee-po-lee-to", "Idria": "Id-ree-uh",
    "Inezeño": "Ee-neh-sayn-yo", "Inés": "Ee-nez", "Ishi": "Ee-shee", "Isleton": "Eye-ul-ton", "Jayme": "High-meh",
    "Joaquins": "Wah-keens", "Jolla": "Hoy-uh", "Jolon": "Ho-lone", "Juaneño": "Wah-nayn-yo", "Juntas": "Hoon-tas",
    "Karuk": "Kuh-rook", "Kizh": "Keech", "Kroeber": "Kro-ber", "Lathrop": "Lay-thrup", "Lebeck": "Luh-beck",
    "Leucadia": "Loo-kay-dee-uh", "Liebre": "Lee-ay-bray", "Llagas": "Yah-gahs", "Lompoc": "Lom-poke",
    "Madera": "Muh-dair-uh", "Miwok": "Mee-wok", "Modjeska": "Mo-jess-ka", "Moroni": "Mo-ro-nye", "Norte": "Nort",
    "Nuys": "Nize", "Palóu": "Pah-lo", "Panochita": "Pa-no-chee-ta", "Pasajero": "Pa-sa-heh-ro",
    "Perillas": "Peh-ree-yahs", "Permanente": "Per-muh-nen-tay", "Peña": "Pen-ya", "Peñasquitos": "Pen-yas-kee-tos",
    "Piru": "Pie-roo", "Placerita": "Plass-er-ee-ta", "Pleito": "Play-toe", "Plumas": "Ploo-mus",
    "Purisimeño": "Poo-ree-see-meh-nyo", "Pío": "Pee-oh", "Rainier": "Ray-neer", "Seco": "Say-ko", "Solis": "So-lees",
    "Stanislaus": "Stan-iss-law", "Tehama": "Tuh-hay-muh", "tejón": "Teh-hone", "Temecula": "Tuh-meck-yoo-luh",
    "Tiburcio": "Tee-boor-see-oh", "Tomales": "Toh-mal-ess", "Trabuco": "Truh-boo-ko", "Tujunga": "Tuh-hung-guh",
    "Tuleburg": "Too-lee-burg", "Uvas": "Oo-vahs", "Vallejo": "Vuh-lay-ho", "Ventureño": "Ven-too-rayn-yo",
    "Vernalis": "Ver-nal-iss", "Visalia": "Vy-sail-yuh", "Wallowa": "Wuh-lau-uh", "Yahi": "Yah-hee", "Ynez": "Ee-nez",
    "Yolla": "Yo-luh", "Zanja": "Sahn-hah",
})
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
    s = re.sub(r"\bBros\.(?=\s+[a-z])", "Brothers", s)                    # "Warner Bros. in 1942" (no sentence end)
    s = re.sub(r"\bBros\b", "Brothers", s)
    s = re.sub(r"\bSCU\b", "S C U", s)                                  # the SCU Lightning Complex
    s = re.sub(r"\bOR-(\d+)\b", r"O R \1", s)                          # wolf tags: OR-7, OR-85
    s = re.sub(r"\bEF(\d)\b", r"E F \1", s)                             # tornado scale: EF3
    s = re.sub(r"\bSargon II\b", "Sargon the Second", s)
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


_ONES_EN = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS_EN = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety"}


def en_number(n):
    """0-999999 in English words (thirty-two, three thousand one hundred twenty-six)."""
    n = int(n)
    if n < 20:
        return _ONES_EN[n]
    if n < 100:
        t, u = divmod(n, 10)
        return _TENS_EN[t] + ("-" + _ONES_EN[u] if u else "")
    if n < 1000:
        h, r = divmod(n, 100)
        return _ONES_EN[h] + " hundred" + (" " + en_number(r) if r else "")
    th, r = divmod(n, 1000)
    return en_number(th) + " thousand" + (" " + en_number(r) if r else "")


def words_en(spoken_text):
    """spoken()'s English with every number in words: "19 37" (a year) -> "nineteen thirty-seven", "18 05" -> "eighteen oh
    five", "3,126" -> "three thousand one hundred twenty-six". For a re-take of a clip Aura read digit by digit."""
    s = re.sub(r"\b(1\d|20) oh (\d)\b", lambda m: f"{en_number(m.group(1))} oh {en_number(m.group(2))}", spoken_text)
    s = re.sub(r"\b(1\d|20) (\d\d)\b", lambda m: f"{en_number(m.group(1))} {en_number(m.group(2))}", s)
    s = re.sub(r"\b(\d{1,3}(?:,\d{3})+|\d+)\b", lambda m: en_number(m.group(1).replace(",", "")) if len(m.group(1).replace(",", "")) <= 6 else m.group(1), s)
    return s


def _ledger(rec):
    if not LEDGER:
        return
    rec["at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    with _ledger_lock:
        with open(LEDGER, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def ledger_spend(path):
    """Dollars logged in a ledger so far: every TTS call's characters (failed ones too) and every Whisper second."""
    chars, asr_s = 0, 0.0
    if path and os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("kind") == "tts":
                chars += int(r.get("chars") or 0)
            elif r.get("kind") == "asr":
                asr_s += float(r.get("seconds") or 0)
    return {"chars": chars, "tts_usd": chars / 1000 * PRICE_PER_1K, "asr_seconds": asr_s, "asr_usd": asr_s / 60 * 0.00051,
            "usd": chars / 1000 * PRICE_PER_1K + asr_s / 60 * 0.00051}


def spoken_for(text):
    """What the voice of this run's language is sent for one unit."""
    if LANG == "es":
        from spoken_es import spoken_es
        return spoken_es(text)
    return spoken(text)


def _level_limited(a, sr, target_db=-19.0, ceiling=0.89):
    """_level's -19 dBFS speech level, but a peak over -1 dBFS is held down by a 5 ms brickwall limiter instead of turning
    the whole clip down (the Spanish samples were made this way). With no peak over the ceiling it equals _level."""
    import numpy as np
    from numpy.lib.stride_tricks import sliding_window_view
    a = a.astype("float32")
    loud = a[np.abs(a) > 0.02]
    rms = float(np.sqrt(np.mean(loud ** 2))) if loud.size else 0.0
    if rms > 1e-4:
        a = a * (10 ** (target_db / 20) / rms)
    if not a.size or float(np.max(np.abs(a))) <= ceiling:
        return a
    g = np.minimum(1.0, ceiling / np.maximum(np.abs(a), 1e-9)).astype("float32")
    w = max(1, int(sr * 0.005))
    gmin = sliding_window_view(np.pad(g, (w, w), mode="edge"), 2 * w + 1).min(axis=1)
    smooth = np.convolve(np.pad(gmin, (w // 2, w - 1 - w // 2), mode="edge"), np.ones(w, dtype="float32") / w, mode="valid")
    return a * np.minimum(smooth[: len(a)], g)


def _trim_es(a, sr):
    """Spanish (3.1.0): cut the silence by the speech's energy in 10 ms frames, not by single samples. Aura-2 Spanish often
    starts a take with a 20-30 ms click and then up to 0.9 s of near-silence (2026-11-21 pilot: the sample threshold kept
    all of it, so clips joined into one line had long gaps). Speech starts where 6 of 8 frames are within 22 dB of the
    take's loud frames (a click is not), reaching back over a quiet start (a soft "s") while frames stay within 30 dB; it
    ends after the last such stretch plus its quiet tail (within 36 dB, at most 200 ms). 30 ms are kept before and 50 ms
    after. Returns an empty array when the take has no speech at all."""
    import numpy as np
    fr = max(1, int(sr * 0.01))
    n = len(a) // fr
    if n < 8:
        return a
    x = a[: n * fr].reshape(n, fr).astype("float64")
    db = 20 * np.log10(np.maximum(np.sqrt((x ** 2).mean(axis=1)), 1e-9))
    top = float(np.percentile(db, 95))
    if top < -45:
        return a[:0]
    c = np.concatenate([[0], np.cumsum((db > top - 22).astype(int))])
    strong = lambda i, j: c[min(n, max(0, j))] - c[min(n, max(0, i))]     # loud frames in [i, j)
    starts = [i for i in range(n) if strong(i, i + 8) >= 6]
    ends = [i for i in range(n) if strong(i - 7, i + 1) >= 5]
    if not starts or not ends or strong(0, n) < 12:
        return a[:0]                          # no speech, or only a click: at least 120 ms of loud frames make a word
    i0, i1 = starts[0], ends[-1]
    while i0 > 0 and db[i0 - 1] > top - 30:
        i0 -= 1
    j = i1
    while j + 1 < n and db[j + 1] > top - 36 and j - i1 < 20:
        j += 1
    return a[max(0, i0 * fr - int(sr * 0.03)): min(len(a), (j + 1) * fr + int(sr * 0.05))]


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


def _aura(text, purpose="clip"):
    """One unit from Aura-2 through the local sampler: WAV bytes in, (samples, rate) out. Retries busy answers. Every try is
    logged to the ledger with its characters (a failed call may still be billed, so it counts too)."""
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
            _ledger({"kind": "tts", "speaker": AURA_SPEAKER, "chars": len(text), "ok": True, "purpose": purpose})
            return a, sr
        except Exception as e:  # noqa: BLE001 - retried, then reported
            err = e
            _ledger({"kind": "tts", "speaker": AURA_SPEAKER, "chars": len(text), "ok": False, "purpose": purpose, "err": str(e)[:200]})
    raise err


def render_clip(text, out, purpose="clip", say=None):
    """Record one unit into out (.m4a): the voice, trimmed and levelled, then AAC 40 kbps, 24 kHz mono. Returns seconds.
    say: other words for the ear than spoken_for(text) (tools/voice/check.py's last re-take of a clip that read a number
    digit by digit: the numbers written out)."""
    import soundfile as sf
    audio, sr = _aura(say or spoken_for(text), purpose)
    if LANG == "es":
        audio = _trim_es(audio, sr)
        if len(audio) < int(sr * 0.08):
            raise RuntimeError("no speech in the take")
        audio = _level_limited(audio, sr)
    else:
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
    return len(audio) / sr


class OverBudget(Exception):
    pass


BUDGET = None


def _make_aura(job):
    key, text, out = job
    try:
        if BUDGET is not None and ledger_spend(LEDGER)["usd"] + len(spoken_for(text)) / 1000 * PRICE_PER_1K > BUDGET:
            raise OverBudget(f"the ledger would pass ${BUDGET:.2f}")
        return key, render_clip(text, out), None
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
    keys, total, sizes = [], 0, {}
    for sub in sorted(os.listdir(vdir)):
        d = os.path.join(vdir, sub)
        if len(sub) != 2 or not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.endswith(".m4a") and len(f) == 18:
                keys.append(f[:14])
                sizes[f[:14]] = os.path.getsize(os.path.join(d, f))
                total += sizes[f[:14]]
    keys.sort()
    idx = {"v": 1, "voice": VOICE_ID, "model": VOICES[LANG]["model"], "n": len(keys), "bytes": total, "keys": "".join(keys)}
    units = []
    try:
        units = json.load(open(os.path.join(REPO, "tools", "voice", VOICES[LANG]["units"]), encoding="utf-8"))["units"]
    except (OSError, ValueError, KeyError):
        pass
    have = set(keys)
    # kids: the clips only the kids stories use (3.1.0); Save for offline leaves them out while Stories for kids is off
    kids = sorted(k for k, t, src, *_ in units if k in have and set(str(src).split(",")) <= {"kids"})
    if kids:
        idx["kids"] = "".join(kids)
        idx["kidsBytes"] = sum(sizes[k] for k in kids)
    with open(os.path.join(vdir, "index.json"), "w") as f:
        json.dump(idx, f, separators=(",", ":"))
    # stream.txt: the clips used only by the long stories (Tell me more, story time) and, 3.1.0, only by the kids stories.
    # The iPhone app leaves them out of its bundle (i5-buddy-ios sync-web.sh) and downloads them from i5.dominares.org the
    # first time (js/voice.js), so Stories for kids adds nothing to the app's size.
    if units:
        stream = sorted(k for k, t, src, *_ in units if k in have and (set(str(src).split(",")) <= {"more", "story"}
                                                                       or set(str(src).split(",")) <= {"kids"}))
        with open(os.path.join(vdir, "stream.txt"), "w") as f:
            f.write("\n".join(stream) + "\n")
    return len(keys), total


def setup(lang, ledger=None):
    """Pick the language's voice (and the ledger) for this process: make.py --lang, and tools/voice/check.py."""
    global LANG, VOICE_ID, AURA_SPEAKER, LEDGER, _ledger_lock
    import threading
    LANG = lang
    VOICE_ID = VOICES[lang]["id"]
    AURA_SPEAKER = VOICES[lang]["speaker"]
    LEDGER = os.path.abspath(os.path.expanduser(ledger)) if ledger else None
    _ledger_lock = threading.Lock()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    global BUDGET
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--engine", choices=["aura", "kokoro"], default="aura")
    ap.add_argument("--lang", choices=sorted(VOICES), default="en", help="en: Asteria (voice/asteria/), es: Estrella (voice/estrella/)")
    ap.add_argument("--ledger", help="append one JSON line per voice call here (characters = the Cloudflare bill)")
    ap.add_argument("--budget", type=float, help="dollars: do not start, or stop, before the ledger's total would pass this")
    ap.add_argument("--index-only", action="store_true", help="only write index.json and stream.txt again")
    ap.add_argument("--only", type=int, default=0, help="record at most N clips (a trial)")
    ap.add_argument("--force", action="store_true", help="record again even when the clip exists")
    ap.add_argument("--show", help="print the spoken form of this text and stop")
    ap.add_argument("--keys", help="a file with one clip key per line: record only these (again, even when they exist)")
    a = ap.parse_args()
    setup(a.lang, a.ledger)
    if a.show:
        print(spoken_for(a.show))
        return
    data = json.load(open(os.path.join(REPO, "tools", "voice", VOICES[LANG]["units"]), encoding="utf-8"))
    vdir = os.path.join(REPO, "voice", VOICE_ID)
    if a.index_only:
        n, total = write_index(vdir)
        print(f"index: {n} clips, {total / 1048576:.1f} MB")
        return
    jobs = []
    only = set(open(a.keys).read().split()) if a.keys else None
    for k, t, *_ in data["units"]:
        out = os.path.join(vdir, k[:2], k + ".m4a")
        if only is not None:
            if k in only:
                jobs.append((k, t, out))
        elif a.force or not os.path.exists(out):
            jobs.append((k, t, out))
    jobs.sort(key=lambda j: -len(j[1]))         # long ones first, so the pool ends evenly
    if a.only:
        jobs = jobs[: a.only]
    planned = sum(len(spoken_for(t)) for _, t, _ in jobs)
    print(f"{len(data['units'])} units, {len(jobs)} to record with {a.jobs} workers ({VOICE_ID}): {planned:,} characters, "
          f"${planned / 1000 * PRICE_PER_1K:.2f}", flush=True)
    if a.budget is not None:
        BUDGET = a.budget
        so_far = ledger_spend(LEDGER)["usd"]
        if so_far + planned / 1000 * PRICE_PER_1K > a.budget:
            print(f"STOP: ${so_far:.2f} spent + ${planned / 1000 * PRICE_PER_1K:.2f} planned would pass the ${a.budget:.2f} budget", flush=True)
            sys.exit(3)
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
