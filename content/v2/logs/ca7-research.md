# ca7: researcher's notes

55 places, 8 zones, 12 trivia.

The file is written, the JSON is valid, and lint_content.py reports 0 errors and 0 warnings across all content files. It has 55 places across exits 566 to 678 (no gap over 8 miles), 8 zones covering 560 to 680 with no gaps (6 have seasons with sources), and 12 trivia questions with the answers spread 3/3/3/3. A backup and the builder scripts are in the scratchpad (ca7build.py, ca7data.py, ca7.backup.json).

Things I was unsure about or changed:
1. Visibility. Mount Shasta from exit 657 (about 80 miles away) is an inference from Wikipedia's statement that it can be seen from the valley floor 140 miles to the south. Lassen Peak from Red Bluff is supported by an NPS photo of the 1915 eruption taken from Red Bluff. Neither source says it is visible from the freeway at those exact spots.
2. Exit numbers for off-freeway places are the access exits I judged best, not checked on a road map: Vina/Lassen's rancho 630, Coleman hatchery 665, Sites Reservoir 586, Reading adobe 664. The 1846 massacre site is only described as "near present-day Redding", so its lat/lon is null at exit 675.
3. Pages read through archived copies. The Glenn County crop report site blocks automated access (403), so Glenn crops use Colusa and Tehama 2024 crop reports and statewide sources. The prune place now says "northern Sacramento Valley" rather than this exact spot. The Granzella's, Orland queen bee (abc10) and California Prunes pages also block automated access, so I read archived copies; the src fields still give the live URLs.
4. The Home of Mrs. John Brown coordinates are an OpenStreetMap geocode of 135 Main St, because Wikipedia's coordinates point to the town of Tehama.
5. For the Herbert S. Miles rest area, the only source on Miles himself is the marker text; the "Tell me more" is about California's rest area program (Caltrans).
6. Existing claims I fixed or dropped because their sources did not support them: College City dates (now 1875 and 1896); Delevan duck count (now 200,000); Granzella's "January 1976, Beverly"; queen bees "80 percent" (now about 200,000 queens a year in Glenn County); Round-Up "close to 10,000 in 1921"; Tehama "Red Bluff stole it"; Mount Shasta "drive past in an hour and a half" (direction-dependent); walnuts "Glenn and Tehama each over 30,000 acres" (now Tehama's 2024 figure); Arbuckle "Home of the Almonds".
7. Duplicate existing places were merged: Red Bluff, Round-Up, Ide Adobe and Lassen each appeared twice, and the Highway 44 Lassen entry was dropped. The Orland Project now lives in the Stony Creek place.
8. I rewrote my Sutter Buttes place so it does not repeat facts the ca6 researcher used at exit 553 (the Native names, the height, guided hikes).
9. ca8 already uses exit 680, so nothing of mine sits there.
