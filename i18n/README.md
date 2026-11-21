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
