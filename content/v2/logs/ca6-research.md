# ca6: researcher's notes

49 places, 10 zones, 12 trivia.

The JSON is valid and lint_content.py reports 0 errors and 0 warnings. Zones run 460-467-481-498-510-518-524-531-537-548-560 with no gaps, and the answer positions in the trivia vary.

1. Over target. There are 49 places against a target of about 40, because nearly all 34 existing places held up. The Sacramento riverfront (exits 518-521) has 10 entries, 7 of them at exit 519. You may want to trim or merge some, for example the transcontinental railroad entry with the Railroad Museum.

2. Existing claims I dropped or fixed because no source I could read supported them:
- "Old Sacramento and I-5": the claim that I-5 bulldozed the Front Street waterfront could not be confirmed (hmdb returned 403). I replaced it with "The Boat Section" (the sunken stretch of I-5, from Wikipedia) plus Old Sacramento's 28 acres and 53 historic buildings.
- Dropped: Lodi's 40% share of Zinfandel; asparagus as the "top region", the February start of harvest and the festival; the June-July sunflower bloom (the UC source was blocked, so that place has no months); the cannery's 16-mile radius, product list and "top five county" claim; the airport rabbit's suitcase; French Camp's "beaver hats went out of style"; the Railyards' 1867 start and "biggest employer until WWII"; Sarah Hall in the Elk Grove story; "overnight" runs and "sank over a year" for the Delta King.
- Fixed: the Tower Bridge vote was in 2001 (repainted 2002); the crane reserve is about 2 miles west, not 5 (from OpenStreetMap); Manteca was a dairy shipping stop, not a creamery.

3. Visibility is my judgment and not checked by eye:
- Marked visible: Port of Stockton cranes, the Woodland cannery (0.5 mi away), the Boat Section walls, and the Stone Lakes heron spot.
- Marked not visible: the Crocker and the Delta King, because I-5 runs below street level there.

4. Coordinates are left null where I had no sourced point: Little Manila, Sharpe Depot (Flying Scotsman), the Holt test, the Railyards, the asparagus and Delta entries, and the sunflower fields. River crossings and some points of interest come from OpenStreetMap.

5. Time-sensitive items: the A's at Sutter Health Park 2025-27; the zoo's expansion (Wikipedia gives no date); the Sacramento Southern excursions (worded "has carried"); the Railyards plans.

6. The Zamora line "highways cut the heart from the town" comes from an unnamed local history that Wikipedia quotes.

7. Zone and exit numbers: the last zone ends at 560 as the brief says, but 560 is not a real exit (build.py treats it as mile 560). I moved the places at non-existent exits 480, 530 and 545 to 481, 531 and 548.

8. Skipped: the Heidrick Ag History Center (website unreachable, so I could not confirm it is open) and an "Elkhorn Rest Area" that appears in OpenStreetMap but that I could not verify.

9. Tooling: the Wikipedia API returned HTTP 429 for part of the run. Other researchers share the scratchpad, so I kept my files in a separate ca6 folder. The builder script that regenerates the file is /private/tmp/claude-501/-Volumes-sugsair-dominares/873627f6-7b60-4fc7-97c5-2ad7d69acb21/scratchpad/ca6/build_ca6.py.
