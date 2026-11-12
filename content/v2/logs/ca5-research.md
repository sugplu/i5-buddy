# ca5: researcher's notes

59 places, 9 zones, 12 trivia.

The file is valid JSON and the project linter reports 0 errors and 0 warnings. It has 59 places (target was about 52), 9 zones covering 330 to 460 with no gaps, and 12 trivia questions. No stretch goes more than 6 miles without a place.

All 28 earlier places and all 3 earlier trivia questions were re-checked and kept. These earlier claims were fixed or dropped:
- Westlands: "more than 1,000 sq mi" became about 614,000 acres.
- Diablo Range: "180 miles long" was dropped because no source gives it.
- San Luis Reservoir: "every drop is pumped in" became "most of its water".
- Mount Diablo: "two thirds of California" became most of Northern California and all of Nevada.
- Gustine: the girl's name is now Sara Miller (middle name Augustine), as the source gives it, and the 1879 date was dropped.
- Tracy: "never saw the town" and "Ohio grain merchant" were dropped. The name Lathrop J. Tracy is kept from tracymuseum.org. Wikipedia gives J. J. Tracy instead.
- Coalinga 1983 quake: "no one was killed" was dropped because the sources disagree (one mentions a heart-attack death). The magnitude is 6.2 Mw from the quake article; the Coalinga town article says 6.5.
- Erreca rest area: the reopening dates (Aug 2025 / May 2026) were dropped because I could not confirm them; Caltrans pages were down. The text says it was rebuilt, but the only source, from Jan 2024, says the project was nearly finished.
- Iron Zoo: now sourced to weburbanist. The claims of more than fifty pumps, Ripley's and a rhino were dropped.
- Firebaugh: the 1854 ferry date was dropped.
- Panoche Hills: the BLM "badlands" wording was dropped.

The 1991 dust storm moved from mile 342 to exit 357, using the Wikipedia article's coordinates. The same article also says "45 miles north of Coalinga", which does not match those coordinates, so the exact spot is uncertain.

Other things I could not confirm:
- Harris Ranch feedlot: no coordinates (left null). Wikipedia puts it beside I-5 at Highway 198, but its own coordinates are 4.3 miles east.
- Sinking ground: the Poland utility-pole site has no exact coordinates. I placed it at exit 368, Panoche Road. The source says it is southwest of Mendota and east of I-5.
- Visibility: San Luis Dam (about 5 miles away) is marked visible without a spot prompt. O'Neill Forebay (about 2 miles) is marked not visible, because its own dam may block the water from the freeway.
- Processing tomato harvest months and pistachio harvest months had no source, so no months are given for them. The earlier zone note about the July to August tomato harvest was dropped.

Exit numbers: as in ca8, "exit" is the where.py exit-mile, so places spread along the freeway use mile numbers that are not real exits (for example 341, 345, 393, 397, 413). Things far off the freeway use the exit you would take to reach them. Two of those sit well away from their map position: SJR refuge is at 449 (map 442) and the Los Gatos crash at 337 (map 344).

Other notes:
- The 1995 Arroyo Pasajero bridge collapse is at mile 327.4, which is ca4's stretch, so I left it out.
- WebSearch did work and was used 3 times.
- Several sites block WebFetch (atlasobscura, hmdb, the Navy pages, ca.water.usgs). I replaced them with other sources and did not try to get around the blocks.
