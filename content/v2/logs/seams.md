# California seam sweep (content/v2, CA exits 0 to 797)

Final cross-file pass, 2026-11-12. Both markers, `ca1-verify.done` and `ca-gaps-verify.done`, were already there when the sweep started, so nothing was missing. Read: ca1.json to ca8.json and ca-gaps.json (377 places, 68 zones, 96 trivia questions before the sweep).

Scope was only the five seam checks: duplicates, the same fact told twice, zone continuity, repeated trivia, and crowding across files. No places or facts were added. The only sentences added are details moved from a removed duplicate into the copy that stays. I re-read those details in this session in the keeper's own source: Wikipedia Tule fog ("from Bakersfield to Red Bluff, ... over 400 miles"), Wikipedia Mount Shasta (Shasta and Karuk names, Narciso Durán's 1817 description) and Wikipedia Yreka (wáik'a, "north mountain" or "white mountain").

How the checks were run: script comparisons over all files for shared 3- and 4-word runs and shared numbers (text against text, text against more, more against more, and zones against places), plus a full read of every place text, zone text and season note. Positions for crowding were computed the way build.py places points: coordinates when within 4 miles of I-5, otherwise the exit's point in tools/extras.json.

Result: 2 places removed (375 left), 24 places edited, 43 zones edited (text or season notes), 0 trivia changed, zone boundaries unchanged. `tools/lint_content.py`: 0 errors, 0 warnings. The files as they were before the sweep are saved in the session scratchpad (`seamsw/backup/`). The edit script there (`seamsw/apply.py`) checks every old string before it replaces it.

## 1. Duplicates (the same thing described twice)

| Removed | Kept | What moved into the keeper's "more" |
|---|---|---|
| ca7 "Tule fog" (591) | ca4 "Tule fog season" (284). Its stretch is on the Los Angeles to Bay Area route, so more drivers pass it, and the fog lasts longest in the southern valley. | "It can stretch more than 400 miles, from Bakersfield all the way to Red Bluff." (now 145 words, 8 sentences) |
| ca8 "A mountain of many names" (746) | ca8 "Mount Shasta" (740) | The Shasta name Waka-nunee-Tuki-wuki and the Karuk name Uytaahkoo, plus the 1817 Spanish description of "a very high hill, entirely covered with snow" (now 142 words, 7 sentences). Its Yreka line went to the Yreka entry (see section 2). |

The ca7 trivia question about what tule fog is named for (exit 591) still stands on its own and was kept. "Mount Shasta from afar" (ca7, 657) was kept. It names the far peak 80 miles off and runs only in winter, and none of its facts repeat ca8's. The pairs that only look alike were also kept, because each describes a different thing: Castle Crags State Park and Castle Crags, the Harris Ranch inn and the feedlot, the Woodland town and its cannery, the Shasta Lake city and the reservoir, and Shasta Dam and its conveyor belt.

## 2. The same fact told twice

### Tule fog (one full telling now: ca4 "Tule fog season")
Removed the winter fog notes from the zones Wheeler Ridge and the valley's edge (ca4), Buttonwillow cotton country (ca4), Patterson and Westley (ca5), San Joaquin River and Lathrop (ca6) and Willows and Glenn County (ca7, "Tule fog season officially runs ..."). For Stockton (ca6), the winter note now keeps only the rain: "Nearly all of Stockton's rain falls from October through April." The Redding zone's general "often with fog" was left.

### Between places (the full telling stays where it is spoken; the copy was cut)
| Fact | Kept in | Cut from |
|---|---|---|
| Path 15 bottleneck behind the 2000 to 2001 crisis, and the third line of Dec. 21, 2004 | ca4 Gates Substation bottleneck | ca5 Path 15 power lines, more. Now only says the newest line (2004, Los Banos to Gates) runs apart and bundles its wires in threes. |
| San Luis Canal is the federal section and carries both projects' water, 13,100 cubic feet a second | ca5 The San Luis Canal, text | ca4 Crossing the California Aqueduct, more |
| 66 miles by gravity from the Coastal Branch split to the Buena Vista plant | ca4 Downhill all the way, text | ca5 Dos Amigos Pumping Plant, more |
| Ground sank about 28 feet from pumping | ca5 The sinking ground, text | ca4 Downhill all the way, more; ca5 zone Panoche Hills, text |
| West Side Freeway built in three phases from the early 1960s | ca4 Start of the West Side Freeway, more | ca6 The last piece of I-5, more. Keeps the 1972 traffic jump near Route 99 and the 1979 link north to Sacramento. |
| Yreka's name from waik'a, the Shasta word for Mount Shasta | ca8 Yreka, text | the removed ca8 entry. Its "north mountain or white mountain" meaning moved to Yreka's more. |
| Sacramento's southernmost big Chinook runs / largest river | ca6 Crossing the Sacramento River | ca7 Red Bluff Diversion Dam, more (first sentence) |
| Shasta Valley gets about 14 inches of rain | ca8 Hay and cattle country, more | ca8 The Shasta River, more |
| San Andreas and Garlock faults meet near the pass | ca3 Tejon Pass summit, text | ca4 Mountains named for a saint, text ("It suits them ..."); ca3 Castac Lake, more; ca3 zone Tejon Pass and Lebec |
| Castaic is named from the same Chumash word for eye | ca3 Castaic Lake and its name, text | ca3 Castac Lake, the eye, text |
| James Dean on Sept. 30, 1955, headed to a race in Salinas | ca4 James Dean's speeding ticket | ca4 Blackwells Corner, text. Now: "James Dean stopped there in 1955, and it is often described as the last place he was seen alive before his fatal crash near Cholame." |
| Tule elk are found only in California | ca4 Tule Elk State Natural Reserve | ca5 Tule elk at San Luis refuge, text ("the smallest kind of elk" kept) |
| Siskiyou Trail followed Native footpaths, and I-5 follows it | ca8 The Siskiyou Trail, text | ca7 Mount Shasta from afar, more ("a landmark for travelers on the Siskiyou Trail" kept) |
| Railroad built up the canyon in the 1880s | ca8 Delta, end of the line, text | ca8 River, rails and road, text. Now "The railroad follows the old Siskiyou Trail." |
| Coast Starlight runs these tracks | ca8 River, rails and road | ca8 Pit River Bridge, text |
| St. Francis Dam flood of March 12, 1928 down the Santa Clara River | ca3 St. Francis Dam disaster, text | ca3 Santa Clara River, more. The wildlife sentence was split to keep 4 sentences. |
| Weed's winds dry lumber | ca8 Weed, text | ca8 Weed's wildfires, text (opener rewritten, facts unchanged); ca8 zone Weed, lumber and wind |
| Mountain Fire started near Gazelle the same afternoon | ca8 Gazelle, more | ca8 Weed's wildfires, more |
| Old 99 survives in Weed as Route 265 | ca8 A two-block highway, more | ca8 Old Highway 99, more |
| Town named Strawberry Valley, then Sisson, then Mount Shasta | ca8 Mount Shasta City, text | ca8 Mount Shasta trout hatchery, more |
| One of three U.S. rivers that cross the Cascades | ca8 Shasta Lake, more | ca8 The Klamath River, more |
| West Side farming grew with the early-1970s aqueduct | ca4 Downhill all the way, more | ca4 Kettleman City, more |
| Miller and Lux headquarters at Buttonwillow | ca4 Henry Miller, the Cattle King, text | ca4 The Buttonwillow tree, more |

### Zone text or season notes that repeated a place's spoken text in the same stretch (the zone copy was cut)
- ca1: San Diego Bay and downtown, "where Spanish California began in 1769". Carlsbad and Oceanside, the spring (bloom and picking dates) and winter (October planting) notes; fall now keeps only the pumpkin season. Camp Pendleton coast, "since 1942".
- ca2: Dana Point and Capistrano Valley, the spring swallows note (March 19). Irvine Ranch and Tustin text is now "The freeway crosses the flat land of the old Irvine Ranch and passes Tustin's old Marine base." It no longer repeats the lima beans, the planned city or the surviving hangar.
- ca3: LA River and Griffith Park, "a soft-bottomed stretch full of willows and wading birds". Santa Clarita Valley spring, "a plant the Tataviam people harvested". Pyramid Lake to Gorman spring, the poppies and lupine clause. Tejon Pass and Lebec text is now "Tejon Pass sits among the open hills of Tejon Ranch around Lebec." Grapevine Canyon, the summer overheating note.
- ca4: Kern River and the Elk Hills, "one of the country's great oil fields". Lost Hills oil and pistachios, the winter (refuge birds) and fall (pistachio shaking) notes. Into Kings County, the Kettleman Hills clause, which the next zone repeated word for word. Kettleman Hills, "the oil field that gave rise to Kettleman City and Avenal".
- ca5: Coalinga plains, the feedlot "by smell". Panoche Hills, the 28 feet of sinking. Firebaugh and the canals, "officially the San Luis Canal". Los Banos and the Grasslands, "a wetland of international importance on the Pacific Flyway". San Luis water crossroads, "Highway 152 heads west over Pacheco Pass". Gustine and Newman, "Two big canals run along the western edge".
- ca6: Lodi vineyards, the fall crane-arrival note. Cosumnes wetlands, the winter flood-habitat note. Downtown Sacramento text is now "I-5 runs between downtown and the river, past Old Sacramento and the Tower Bridge." The winter Discovery Park note was removed. The airport and the Sacramento River, the county-line clause. Yolo Bypass text is now "Between floods, much of the Yolo Bypass is farmed, mostly in rice." The summer farming note was removed, since it now repeated the text. Woodland and Cache Creek, the summer cannery note.
- ca7: Almonds, rice and the Sutter Buttes, the winter pollination note. Rice fields and wildlife refuges, the fall ducks-and-geese note. Willows and Glenn County text is now "North of Willows, almond orchards grow around Artois." It no longer repeats the forest headquarters, and the prune note was removed. Red Bluff rangeland, the Mount Shasta skyline clause and the winter 140-mile note. Cottonwood and Anderson, the stagecoach town and railroad town clause.
- ca8: North Redding, the dam-camps origin of Shasta Lake city. Shasta Lake, "California's largest reservoir", the drought-year bridges and the 1,500 seasonal residents. Sacramento River canyon, river, railroad and I-5 squeezing together. Mount Shasta and Black Butte, "at 3,912 feet", the 103 inches of snow (the 1959 Ski Bowl record stays) and the spring hatchery note. Shasta Valley, "of an ancient landslide". Klamath River to the Oregon line, "bending south to meet I-5" and the fall first-salmon note.

Zones whose last note was removed now have `seasons: null`, like the other zones without notes. Zone lines that only name or point out a landmark the next place describes, such as "Mount Diablo shows on the northwest skyline", were left alone. Season notes that repeat only a place's "Tell me more" text, not its spoken text, were also left.

Left on purpose: Patwin described as southern Wintun in both ca6 Capay Valley and ca7 Patwin homeland (an identity line, not a story); the Delta-Mendota Canal ending near Mendota in both ca5 Mendota and ca5 Two canals (each needs it); the aqueduct being pumped over the Tehachapis in ca3 Vista del Lago, ca4 Edmonston and ca4 Downhill (a supporting clause in each, with the full telling at Edmonston).

## 3. Zones
68 zones, all state CA, run 0-9-20-...-785-797 with no gaps or overlaps and every label 38 characters or less. No boundary was changed.

## 4. Trivia
96 questions. No question is asked twice and no two share an answer. Nothing changed.

## 5. Crowding (4 or more places within 2 miles)
Across files, only one cluster has places from more than one file: Sacramento, 518.0 to 519.5. It holds ca-gaps "Sacramento, the state capital" at exit 518, plus ca6's Tower Bridge, Boat Section and Railroad Museum: 4 places in 1.5 miles, and 5 in 2.3 miles with Where two rivers meet. I left it as it is. The ca6 brief allows 4 or 5 places at the riverfront, and no 2-mile window holds more than 4. Moving the capital entry outside the window would put it more than 2 miles from the Capitol (where.py 519.4). The ca-gaps check's timing test found every announcement starting at least 1.27 miles ahead of its place. Two other cross-file groups, Anaheim 108.3 to 110.7 and Tejon 204.8 to 207.2, span more than 2 miles, so neither counts.

Clusters inside a single file were left alone, because they are outside "across files". Each needs a place merged or cut, which is a call for the file's owner:
- ca3 161.2 to 162.5: Aqueduct Cascades, Newhall Pass Interchange, Oak of the Golden Dream (exit 162, 4.6 mi off), Beale's Cut.
- ca3 170.2 to 172.0: Santa Clara River, Six Flags, The Death Valley rescue, St. Francis Dam (exit 172, 7.2 mi off).
- ca8 730.3 to 732.1: Dunsmuir, Upper Soda Springs, Babe Ruth in Dunsmuir, Hedge Creek Falls. Babe Ruth's facts would fit in Dunsmuir's "more" (6 sentences, 97 words). Its exit, 731, is not a real exit; the exits there are 730 and 732.
- ca8 738.0 to 740.0: trout hatchery, Mount Shasta City, Headwaters of the Sacramento, Mount Shasta (just inside 2 miles).
- ca8 747.0 to 748.0: Pluto's Cave, Weed, Weed's wildfires, A two-block highway. This was 5 places in 2 miles until the Mount Shasta duplicate came out. Weed's wildfires would fit in Weed's "more" as one sentence, but the Mill Fire details would then need its own source in Weed's src2.

## Noticed, not changed (outside this sweep)
- The ca8 "Mount Shasta and Black Butte" winter note gives the answer to the ca8 trivia question about the 1959 Ski Bowl storm (exit 738) on entering the zone.
- The app does not use the places' "months" field yet, so seasonal places such as "Tule fog season" are spoken all year.
