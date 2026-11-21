# I-5 Buddy's words (3.1.0)

`en.json` is every word the app shows or says, by key. `es.json` has the same keys; an empty value means "not translated
yet" and the app shows the English for that key. `js/i18n.js` reads both (see the top of that file);
`tools/test-i18n.html?s=keys` checks them.

For whoever writes `es.json`:

- **Context.** `python3 tools/i18n_context.py --out /tmp/i18n-context.json` lists, for every key, its English, whether
  the app speaks it (`spoken`) and each line of code that uses it. Spoken lines are read aloud by a Spanish device voice
  for now (and recorded later): write them to be heard, with numbers and units as words around them.
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
