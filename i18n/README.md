# I-5 Buddy's words (3.1.0)

`en.json` is every word the app shows or says, by key. `es.json` has the same keys; an empty value means "not translated
yet" and the app shows the English for that key. `js/i18n.js` reads both (see the top of that file);
`tools/test-i18n.html?s=keys` checks them.

For whoever writes `es.json`:

- **Context.** `python3 tools/i18n_context.py --out /tmp/i18n-context.json` lists, for every key, its English, whether
  the app speaks it (`spoken`) and each line of code that uses it. Spoken lines are recorded in the voice Estrella
  (3.1.0): write them to be heard, with numbers and units as words around them (digits are fine: the recording says
  them in words, see below).
- **Changing a spoken Spanish value** (or a Spanish story) changes the clip it needs: the line falls back to the device's
  Spanish voice until it is recorded again (below).
- **Blanks.** Keep every `{name}` of the English, spelled the same, each exactly once or as often as the English has it;
  you may move them. `nar.lead_name_text` is `"{lead}: {name}. {text}"`: keep the punctuation that separates them.
  The test fails on a missing or extra blank.
- **Plurals** are two keys (`trip.stamp_word` / `trip.stamps_word`, `nar.climb_one_mile` / `nar.climb_n_miles`).
- **Markup.** `html.*` keys from `data-i18n-html` hold a little HTML (`<b>Lina</b>`): keep the tags.
- **Bingo squares** (`play.sq_*`) are short labels for a 60 px square; `~` marks where a long word may break
  (`"Motor~cycle"`). Keep them short.
- **Joseph's words:** Settings > Stories for kids is "Historias para niños".
- **Voice:** Mexican and US Spanish, `usted`, like the Spanish site pages (`es/`) and the voice samples.
- **Do not translate:** I-5 Buddy, Dominares, Lina, Caltrans, CHP, Geoapify, OpenStreetMap, place and road names that are
  proper names (the content step decides each place's `name_es`), units (`mi`, `ft`, `mph` stay).
- **Not here:** the landmark stories, zones, trivia and missions are content (`*_es` fields in `content/`, built into
  `data/i5.es.js` by `tools/build.py`); the place names come from there too. Ask Buddy and voice commands stay English
  in 3.1.0 (`js/listen.js` has no keys besides the two that say so).

## How the Spanish was written (3.1.0 content step, 2026-11-21)

`es.json`, the content's `*_es` fields, `content/names_es.json` and the postcards' `lines_es` / `templates_es` were written
by Claude Opus 5.5 and checked by back-translation with Claude Sonnet 5.5 (`claude-power/jobs/i5_es_kids.py`, credit program
round 9; the job's working files are in `~/Dominares/ship/i5-es-job/` on the Pro):

1. **Glossary first** (`i5-es-job/glossary.json`): the recurring names and road words, decided once so every request says
   them the same way, following the Spanish website (`es/`): place names as signed, no added accents (Los Angeles, San
   Joaquin, Tejon Pass); rivers `el río Sacramento`, valleys `el valle de San Joaquin`, creeks and dams keep their names;
   Native peoples in lowercase as Spanish writes peoples (`los kumeyaay`); `la I-5`, `la salida N`, `millas`,
   `área de descanso`, `autopista`; mission place names = the passport's names.
2. **Write**: every key with its code line (`i18n_context.py`), every story with its name, long story and I-spy line;
   neutral Mexican Spanish, `usted`, every number, date, side and hedge as in the English. Fixed words: the tabs Manejar /
   Adelante / Mapa / Pasaporte / Juegos, Ajustes, Lotería del camino, Preguntas, Fiesta en el auto, Historias para niños.
   US, Canadian and Mexican states in the license plate game use their Spanish names (Nueva York, Michoacán).
3. **Check**: Sonnet translates the Spanish back into English without the English wording and flags every added, missing
   or changed fact, number, name, side or hedge, tú forms and broken blanks. A flagged item was written again once with
   the flags as feedback and checked again; what was still flagged after that was decided by hand (the job's state file
   lists it).

Every Spanish content field keeps the hash of the English it was written from (`es_src`); `tools/build.py` leaves out a
Spanish field whose English has changed since and says so in `tools/build-report.txt`, so a fact fixed in English never
ships next to the old Spanish. For `es.json` there is no such guard: when you change an English value in `en.json`, empty
its Spanish value (English shows) or write the new Spanish.

## Stories for kids

Each place's `kids` (English) and `kids_es` (Spanish) story was written by Claude Opus 5.5 from that place's own story
(`text`, and its I-spy line), for children aged 6 to 11: only the story's facts, short sentences, one "look for" line (only
for a place that can be seen) or one question, nothing scary (a sad story says only that something sad happened here long
ago), no ads, no left or right. The Spanish one is written from the Spanish story and speaks to the kids as `ustedes`.
Claude Sonnet 5.5 checked each against its source story; a flagged one was written again once. `kids_src` (the hash of
the story they came from) makes `tools/build.py` leave both out when the story changes.

## The Spanish voice (Estrella, 3.1.0 ship step)

Every Spanish line the app speaks with fixed words (the same lines Asteria has in English) is a clip in `voice/estrella/`,
named by the hash of the line's unit as shown (`js/voice.js` `speechUnits` and `unitKey`, exactly like Asteria's).

1. `python3 tools/voice/collect.py --page "tools/voice/units.html?lang=es" --out tools/voice/units-es.json` lists the units
   with the app's own Spanish words (headless, muted, silent).
2. `~/Dominares/tts/.venv/bin/python tools/voice/make.py --lang es --ledger LEDGER --budget USD` records the missing ones
   through the local sampler (`~/Dominares/ship/i5-es-voices/make/tts-sampler-es`, `wrangler dev`, never deployed).
   What the voice is sent comes from `tools/voice/spoken_es.py`: numbers in Mexican Spanish words with the gender of what
   they count ("veintiuna millas", "doscientos pies", "mil ochocientos seis"), "la I-5" as "la interestatal cinco", "la
   U.S. 101" as "la u ese ciento uno", ordinals ("1.ª" primera), times, amounts, Roman numerals and a few English
   abbreviations; place names stay as written. `python3 tools/voice/spoken_es.py --test` checks it.
3. `~/Dominares/tts/.venv/bin/python tools/voice/check.py --lang es --ledger LEDGER --report REPORT` sends every clip to
   Whisper (Workers AI) and records again, up to twice, a clip heard differently or far too long or short for its words;
   the better take is kept. Nothing is ever played on the Mac. The clips that still differ are in
   `tools/voice/whisper-estrella.json` (mostly English names the Spanish recognizer writes its own way).
4. `python3 tools/voice/collect.py --page "tools/test-voice.html?real=1&lang=es" --out /tmp/v.json` decodes real clips in
   the browser and joins them into the app's lines (`&kids=1` for the kids stories, `&all=1` for every place).

Turn-by-turn has its own Spanish grammar in `js/nav.js` (see ARCHITECTURE.md, Words and languages).
