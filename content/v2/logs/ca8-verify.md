# ca8 verification log (CA exits 680-797)

Adversarial fact-check of `content/v2/ca8.json`, 2026-11-10.

- Checked: 64 places, 9 zones, 12 trivia questions.
- Fixed: 56 places (most were small precision fixes), 3 zones, 5 trivia.
- Deleted: 0 places, 0 trivia. No place failed at its core.
- Every Wikipedia source was re-downloaded fresh in this session (`wiki.py full`). Non-Wikipedia sources were read with WebFetch. The Siskiyou 2023 crop report PDF was downloaded and its text extracted locally.
- Coordinates: every place with coordinates was compared with `wiki.py coords`, Wikidata, or OpenStreetMap (Nominatim / `tools/extras.json`), then run through `where.py`. All exits are now within 2 of the where.py exit-mile. The exceptions are McCloud (6.3 mi off the freeway, exit 736 is its access exit) and distant mountains.
- Writing rules: a script checked every text, more, spot, zone and trivia string for word limits, sentence counts, direction words, dashes, hype words and exclamation marks. No string fails.
- Zones: 680-688-704-722-735-746-756-770-785-797. No gaps or overlaps, and each zone is 8 to 18 miles long.

## Places

**Old Shasta (680)**: text now says "about six miles west of Redding" (the source's wording), not "six miles away". "The oldest Masonic lodge in California" is reworded as "a Masonic lodge described as the oldest in California", because it is an unsourced superlative. The rest was confirmed: 3,500 people, the 1873 railroad bypass, losing the county seat in 1888, the 1861 courthouse, the Queen City name, Joaquin Miller, the Carr Fire. Sources: Wikipedia Shasta, California; parks.ca.gov page 456.

**The 9.5-mile conveyor belt (682)**: "the largest conveyor belt system in the world" became "what was then the largest". "1,100 tons of rock" became "1,100 tons of material", the source's word. The more text was confirmed in full. Source: Wikipedia Shasta Dam.

**Shasta Lake, the dam towns (684)**: confirmed and unchanged. Source: Wikipedia Shasta Lake, California.

**Shasta Dam (685)**: "about half of the best spawning habitat in the Sacramento River system" became "half of the best salmon habitat in the Sacramento River basin", which is what the source says. The roughly 400-foot tour elevator was confirmed by usbr.gov (tours run Friday to Tuesday), and Wikipedia gives 428 ft. Everything else was confirmed: 602 ft, 26 months early, second only to Hoover, the "secondest dam" quote, the planned 800 ft, Crowe's quote. Coordinates match Wikipedia. Sources: Wikipedia Shasta Dam; usbr.gov/mp/ncao/shasta-dam.html.

**Kennett, the drowned town (687)**: src2 changed to the Shasta Dam article, because the 1937 groundbreaking held in Kennett comes from there and not from the Kennett article. "Held right in Kennett" became "held in Kennett", since "right" could sound like a direction. The rest was confirmed. Sources: Wikipedia Kennett, California; Wikipedia Shasta Dam.

**The drowned highway (688)**: removed "Tunnels and roadbed from the old railroad line show up too" from the text. It is true (Wikipedia Shasta Lake), but neither of this place's sources supports it. The zone text still carries it. The more text was confirmed. Sources: Wikipedia U.S. Route 99 in California; Wikipedia Shasta Dam.

**Shasta Lake (689)**: "to trap deer and other game" became "as traps for game that came to drink". The source never mentions deer. Dropped "near the big bridge" for Bridge Bay because no source places it. "Eleven bands" was confirmed in Wikipedia Pit River Tribe. Four times the flow, three rivers crossing the Cascades, 700 slips and 100 houseboats were all confirmed. Sources: Wikipedia Shasta Lake, Pit River, Pit River Tribe.

**Bass Hill stage road (690)**: "a marker from the stagecoach days" became "a marker to the stagecoach days". The marker went up in 1920, after the stages stopped running in 1887. The rest was confirmed, including CHL No. 148 and the marker title. Sources: Wikipedia Bass Hill (California); ohp.parks.ca.gov/ListedResources/Detail/148.

**Pit River Bridge (691)**: the text was reworded to match the source. It is now "the highest double-deck bridge in the United States", and a full lake "comes within about 40 feet of the bridge". The 1953 rescue and the Pulitzer story were confirmed. Sources: Wikipedia Pit River Bridge, Virginia Schau.

**The giant median (693)**: removed "with whole hillsides between them", which is unsourced. The median ranking is now worded as "said to be the second-largest", because the Wikipedia claim cites no source. The more text was confirmed. Source: Wikipedia Interstate 5 in California.

**Shasta salamanders (694)**: "long thought" became "once thought". The 2021 decision is now worded "did not warrant" protection, the source's legal wording. Source: Wikipedia Shasta salamander.

**Lake Shasta Caverns (695)**: removed "with carbide from his miner's lamp". The 1878 inscription cannot have been written with carbide, because calcium carbide was first made economically in 1892 and carbide lamps came in around 1900 (Wikipedia Carbide lamp). The text now says his discovery claim is still legible. The more text adds the Wintu, from the caverns' official history page. "Every kind of formation" was tightened to "every type of limestone formation". O'Brien's name origin was confirmed in Wikipedia O'Brien, California. The 900 ft height and the boat and bus trip were confirmed by lakeshastacaverns.com. Sources: Wikipedia Lake Shasta Caverns; lakeshastacaverns.com and its /history page.

**Winnemem Wintu homeland (696)**: "still seeking federal recognition" became "have long sought". The source only confirms the effort as of 2021. "The tribe held a war dance" became "the Winnemem held". The source says one faction held it. The 1854 massacre, the 1941 act and the 90 percent figure were confirmed. Sources: Wikipedia Winnemem Wintu, Shasta Dam.

**The Salt Fire (698)**: confirmed and unchanged. Coordinates match Wikipedia. Source: Wikipedia Salt Fire (2021).

**The first federal fish hatchery (700)**: the bows-and-arrows scene is now attributed to Stone ("Stone wrote that..."), since it comes only from his own report. The rest was confirmed. Sources: Wikipedia National Fish Hatchery System, Livingston Stone.

**Lakehead, top of the lake (702)**: replaced the 2000 population with the 2020 one (469, so "about 470"). Dropped "near where the Sacramento River flows in", which is unsourced. "The final 13 miles of freeway" became "a final 13-mile stretch of I-5", so it does not sound like the last miles of I-5. Sources: Wikipedia Lakehead, California; Interstate 5 in California; Shasta Lake.

**Delta, end of the line (707)**: "train ride south" became "train ride to Redding". The school is now "the old one-room Delta school, since enlarged". The source says it has been enlarged over the years. Sources: Wikipedia Delta, California; Delta Fire.

**The upper Sacramento River (711)**: "famous trout stream" became "blue ribbon trout stream, where wild rainbow trout abound". The Sacramento River article does not support the trout claim, but Wikipedia Dunsmuir does. "15 percent of the water flowing into Shasta Lake" was confirmed in Wikipedia Mount Shasta City Park, not in the cited article.

**Portuguese Flat (712)**: "Its rich diggings made it one of the roughest camps" claimed a cause the source does not give. It became "It had rich diggings and a reputation as one of the roughest camps". Miller's arrow wound is now "by his own account". Source: Wikipedia Portuguese Flat, California.

**River, rails and road (715)**: "The railroad arrived in 1887" became "in the 1880s". The sources disagree: Dunsmuir station says 1886 and Dunsmuir says 1887. The Beebe quote was restored to his exact words ("brooding, symmetrical cone"). The Amtrak sentence was reworded to match Wikipedia Dunsmuir station. "Only stop in Siskiyou County" was confirmed in Wikipedia Dunsmuir. Sources: Wikipedia Dunsmuir, California; Shasta Daylight; Dunsmuir station; Coast Starlight.

**Southern's stage station (718)**: "raised ten children" became "had ten children", the source's wording. The rest was confirmed. Sources: Wikipedia Southern Hotel & Stage Station; Black Bart (outlaw); ohp.parks.ca.gov/ListedResources/Detail/33.

**The Siskiyou Trail (720)**: "Gold Rush mule trains managed perhaps 20 miles a day" became "Early travelers on mules and horses...", to match the source. Sources: Wikipedia Siskiyou Trail, Ewing Young.

**Homeland and the 1855 battle (723)**: "a small Shasta-speaking people" became "the Okwanuchu Shasta people". "Small" is unsourced. Reverence is now in the present perfect ("have long been revered"). Miller's wound is now attributed to his own writing. The massacre is described plainly. Sources: Wikipedia Castle Crags, Battle of Castle Crags.

**Castle Crags State Park (724)**: confirmed and unchanged: 28 miles of trails, the Vista Point, the PCT, the Crags Trail, 925 acres in 1943, the 1889 bottling works. Sources: Wikipedia Castle Crags; parks.ca.gov page 454.

**Castle Crags (726)**: dropped "gray" from the text and spot because no source gives the color. Dropped "deep" from "formed deep underground". The rest was confirmed, including more than 170 million years (parks.ca.gov), the 1984 wilderness, the cirques and Castle Lake, and Yosemite. Sources: Wikipedia Castle Crags, Castle Crags Wilderness.

**Sleep in a caboose (728)**: "long called Railroad Park Resort" became "once called". The source only says "formerly". Dropped "at the foot of the Crags", which is unsourced. Coordinates were confirmed against OpenStreetMap (Jubilee Railroad Wilderness Lodge, 41.1850, -122.2931). Sources: jubileerailroad.com and its /our-story page.

**Dunsmuir, the railroad town (729)**: the water claim is now worded as the town's slogan, "Home of the Best Water on Earth". The rest was confirmed. Sources: Wikipedia Dunsmuir, California; Dunsmuir station.

**Upper Soda Springs (730)**: dropped "fizzy", which is unsourced. Dropped "came by train", which is not stated. Source: Wikipedia Upper Soda Springs.

**Babe Ruth in Dunsmuir (731)**: confirmed and unchanged. Source: Wikipedia Dunsmuir, California.

**Hedge Creek Falls (732)**: confirmed and unchanged. Sources: Wikipedia Hedge Creek Falls, Black Bart (outlaw).

**Where Shasta soda began (733)**: "Mossbrae Falls can only be reached by walking the railroad tracks" was false. The source lists private trails and rafting as other ways in. It now says the usual route means trespassing on the tracks. Sources: Wikipedia Shasta Springs, Mossbrae Falls.

**The Cantara Loop spill (734)**: coordinates moved from 41.266, -122.3075 to 41.2603, -122.286. The new point is the Cantara Loop as given in Wikipedia Horseshoe curve. The old point could not be confirmed. where.py puts the new point at mile 734.3, 0.6 mi off the freeway, so exit 734 is still right. "Millions of insects" became "insects and other small river creatures", because the source says invertebrates. Sources: Wikipedia Dunsmuir, California; Sacramento River.

**McCloud, a company town (736)**: "sold to private owners" became "passed to private owners", because the source says "transferred". The Joaquin's Book statue was confirmed in Wikipedia Joaquin Miller. Source: Wikipedia McCloud, California.

**Mount Shasta trout hatchery (737)**: Sisson is now "first postmaster" of Berryvale, the source's wording, not "ran" it. "Breeding trout" became "trout here", because the page only says fish there grow to nearly 10 pounds. The months March to July are sourced: CDFW says the egg and fry viewing runs mid-March through July. Sources: wildlife.ca.gov/Fishing/Hatcheries/Mount-Shasta; Wikipedia Strawberry Valley Station.

**Mount Shasta City (738)**: name order clarified (Strawberry Valley, then Berryvale, then Sisson). "Railroad's arrival in 1887" became "completion". Shasta Abbey's founding year was dropped, because Shasta Abbey says 1970 and Mount Shasta says 1971. The 1995 Black Bear Diner was confirmed in Wikipedia Black Bear Diner. Loos, 1905, 349.6 in. and 103 in. were confirmed. Source: Wikipedia Mount Shasta, California.

**Headwaters of the Sacramento (739)**: "began as snow and ice on the mountain" became "started as glacial melt", the source's words. Source: Wikipedia Mount Shasta City Park.

**Mount Shasta (740)**: "biggest volcano by volume in the whole Cascade Range" was wrong. The source says the most voluminous stratovolcano, and the text now says so. The 2002 glacier survey now adds the researchers' warning that warming would likely make the glaciers retreat. The finding alone was misleading today. Sources: Wikipedia Mount Shasta, Whitney Glacier; usgs.gov (very high threat).

**The Lemurians legend (741)**: "supposedly living inside the mountain" became "a hidden city on the mountain", because "inside" is not in the source. "Nobody has found the door yet" became "No one has ever found the city". "Made the legend famous" became "cemented the legend", the source's wording. Sources: Wikipedia Mount Shasta, Lemuria.

**Black Butte (742)**: "roughly 10,000 years ago" became "about 9,000 to 10,000 years ago". Dropped "bare" from the text and spot (unsourced). "Right beside" became "close beside". The railroad sentence is now "the Cascade Line... meets the older Siskiyou Line". The old wording called both the railroad's main lines, but the Siskiyou Line was leased out and has closed at times. Source: Wikipedia Black Butte (Siskiyou County, California).

**Mount Eddy (744)**: "long credited" became "often mistakenly credited". Harriet Eddy is now "among the first women", because Mount Shasta lists her with Mary McCloud's party. Added the Wintu name Num-mel-be-le-sas-pam ("west blaze mountain"), from the same Mount Eddy article. "Shasta River begins on its east slope" was confirmed in Wikipedia Shasta River. Sources: Wikipedia Mount Eddy, Klamath Mountains.

**Shastina and Diller Canyon (745 to 743)**: exit changed to 743. where.py puts Shastina at mile 741.0, so 745 was 4 off. The pyroclastic flows are now credited to Shastina together with Black Butte, as the source says. "The highest lakes in the whole Cascade Range" became "the highest open-air lakes". A lake under Mount Rainier's summit ice is higher. Sources: Wikipedia Shastina, Mount Shasta.

**A mountain of many names (746)**: confirmed and unchanged. Sources: Wikipedia Mount Shasta, Yreka, California.

**Weed, a windy lumber town (747)**: confirmed and unchanged. Sources: Wikipedia Weed, California; Abner Weed.

**Pluto's Cave (747)**: coordinates confirmed. Wikidata Q7205668 gives 41.5682, -122.2825 and OpenStreetMap entrances are within about 100 m. The 1870 pistol-and-candle scene now says King was repeating an experiment from his 1863 visit with Brewer, as King's quote says. Source: Wikipedia Pluto's Cave.

**A two-block highway (748)**: removed "about half a mile" (unsourced). Sources: Wikipedia Weed, California; California State Route 265.

**Weed's wildfires (749)**: "Strong winds have also driven" became "The same strong winds that dry lumber have driven". "Also" made no sense when the place is heard on its own. Sources: Wikipedia Mill Fire (2022), Lava Fire (2021), Boles Fire.

**Gazelle's antelope name (751 to 759)**: where.py puts Gazelle at mile 757.0, 2.3 mi west of the freeway, so 751 was 6 off. Because it is within 4 miles, the app narrates it at mile 757, where "The Edgewood and Gazelle exit leads to Gazelle" would be misleading. The exit is now 759 (Louie Road), the nearest real exit. The text now says "West of the freeway sits Gazelle", gives the 2020 population (95), and no longer implies the steamer is in "the town's history". The Shasta River facts in the more text were confirmed in Wikipedia Shasta River. Sources: Wikipedia Gazelle, California; Mill Fire (2022).

**Old Highway 99 (755)**: "Californians called it" became "It was known as". Source: Wikipedia U.S. Route 99 in California.

**The hummocks of Shasta Valley (759)**: "cuts right through" became "cuts through". Confirmed: 300,000 to 500,000 years ago, 170 sq mi, one of the largest landslides known on Earth (usgs.gov); 6.5 cu mi and 28 mi (Wikipedia Mount Shasta); just past Montague (Wikipedia Shasta River).

**Hay and cattle country (762)**: "Hay is the county's biggest field crop" became "Alfalfa hay", which the 2023 report shows: 29,184 acres, 175,104 tons, $28.9M. The rest was confirmed against the report PDF: four farming areas, 45,175 cattle and calves on Jan 1, 2023, 445,000 acres of rangeland pasture, $111.9M for bulls plus cows plus steers and heifers, mint. "Grazes cattle on" became "counts... rangeland pasture". The rain shadow was confirmed in Wikipedia Montague, California, and 14 inches in Wikipedia Shasta River. The grasshopper harvest was confirmed in Wikipedia Shasta people.

**A billion strawberry plants (764)**: "most valuable crop" became "most valuable farm product", because cattle are not a crop. The 451 million total is now described as crop, livestock and timber value. Confirmed against the report: 2,842 acres at 360,000 plants per acre, $184.2M, $200.8M nursery, potatoes 1,866 plus 1,466 organic acres, 170 acres of horseradish.

**Shasta Valley Wildlife Area (766)**: coordinates confirmed as the OpenStreetMap centroid of the reserve (41.7033, -122.4717). "Hawks" became "birds of prey" (the page says raptors). Added riverside forest (riparian). "Big rainbow trout" became "rainbow trout". Removed the specific weekday and October to January access rules, which are operating details that can go stale. The text now says only that access is limited in hunting season. Source: wildlife.ca.gov/Lands/Places-to-Visit/Shasta-Valley-WA.

**State of Jefferson (770)**: "old Highway 99" became "U.S. 99", because it was not "old" in 1941. The source hedges that the gold pan was "ostensibly" the first model for the seal, so the text now says "said to be". Sources: Wikipedia Jefferson (proposed Pacific state), Yreka, California.

**Yreka, the gold town (773)**: confirmed and unchanged. Coordinates match Wikipedia. The courthouse dates (1857 to 2021) were confirmed in Wikipedia Siskiyou County Superior Court, and kahtishraam and Rain Rock in Wikipedia Karuk Tribe.

**Yreka builds its own railroad (776)**: removed "running about nine miles" (unsourced). Sources: Wikipedia Yreka Western Railroad, Montague, California.

**The Shasta River (779)**: "runs 58 miles north" became "runs 58 miles through Shasta Valley", because the source says northwest. The more text no longer says snowmelt is part of the groundwater. The source lists groundwater, irrigation return flows, and "also some" snowmelt from lava-tube springs. Source: Wikipedia Shasta River.

**The Shasta people (781)**: "Shasta Valley and the middle Klamath River are the homeland" became "are part of the homeland". "The band along the Shasta River" became "the people of the Shasta River", the source's term. "Quartz Valley Indian Community" became "Quartz Valley Indian Reservation", as in the source. "The Confederated Tribes of Grand Ronde and Siletz" became "the Grand Ronde and Siletz reservations", because these are two separate tribes. "California rejected all 18 treaties made that year" became "one of 18 California treaties that the state opposed and the U.S. Senate rejected". The treaties were rejected in Washington in 1852. The poisoning is now framed as Shasta accounts. The 1910 estimate of 100 is Kroeber's. Source: Wikipedia Shasta people.

**The Klamath Mountains (783)**: "one small area" became "a single square mile", the source's figure. Source: Wikipedia Klamath Mountains.

**The Klamath River (786)**: "bends south to meet I-5" was confirmed in Wikipedia Course of the Klamath River ("turns sharply south as it meets Interstate 5") and kept with that wording. "The last of the dams was gone by August 2024" became "in 2024", because the sources give August and October. "About 400 miles" reopened was confirmed in Course of the Klamath River (Newsom announcement). "Young Indigenous paddlers" became "Indigenous teenagers from the region". The spot changed from "under the bridge" to "below the freeway bridge". Sources: Wikipedia Klamath River; Course of the Klamath River; Pit River (three rivers that cross the Cascades).

**Randolph Collier Rest Area (786)**: coordinates confirmed against the OSM "Randolph E. Collier Rest Area" (41.8525, -122.5716). Its location near the Klamath was confirmed in Wikipedia California State Route 96 (SR 96 passes the rest area and ends near the Shasta and Klamath confluence). "He wrote the bill that renumbered" became "his bill to simplify California's highway numbers". Sources: Wikipedia Randolph Collier, U.S. Route 99 in California.

**Into Karuk country (787)**: removed "with more than 3,600 members", which neither article supports. It is replaced with the 2010 census count of 6,115 ("about 6,100") from Wikipedia Karuk. "1.38 million acres" became "more than a million acres", the source's figure. "Karuk means upriver people" became "Karuk means upriver". "Offices in Happy Camp, Orleans and Yreka" became "serves its people from", matching "government service areas". Sources: Wikipedia Karuk, Karuk Tribe, California State Route 96.

**Where Siskiyou got its name (789)**: "French-speaking fur trappers named a river ford" became "Hudson's Bay Company trappers gave a river ford the French name". Sources: Wikipedia Siskiyou Mountains, Siskiyou County, California.

**Hilt, the last exit, renamed Hilt, the border town (796)**: "the last exit in California" depends on direction, and the name is spoken aloud too. The name is now "Hilt, the border town" and the text says "the northernmost I-5 exit in California". Removed "Hilt sits at about 2,900 feet" (unsourced). Removed "the citrus growers' cooperative". The lumber-then-Fruit Growers order and "an affiliate of Sunkist" were confirmed in Wikipedia List of company towns in the United States. The Klamathon Fire facts were confirmed. Sources: Wikipedia Hilt, California; Klamathon Fire; Siskiyou Mountains.

**The 42nd parallel (797)**: "parts of the boundary have been disputed ever since" became "creating a dispute that continues to this day", the source's claim. "A 25-million-year-old volcanic plug" became "about 25 million years old", since the source gives 25.6 million. Pilot Rock was confirmed in Wikipedia Pilot Rock (Oregon). Sources: Wikipedia Adams–Onís Treaty, Siskiyou Summit.

## Zones

- **Shasta Lake (688-704)**: "crosses the arms of California's largest reservoir" became "crosses California's largest reservoir". No source says I-5 crosses more than one arm.
- **Sacramento River canyon (704-722)**: in the winter season note, "chain controls are common" became "Caltrans sometimes requires chains", the source's wording (Wikipedia Interstate 5 in California).
- **Castle Crags and Dunsmuir (722-735)**: "three and a half times what Yreka gets" became "as much as Yreka or Medford". The source compares Dunsmuir with both.
- **The other 6 zones and all season notes were confirmed and kept.** Zone 1 climate: Shasta Lake, California. Bridge Bay summer and Lakehead seasonal residents: Shasta Lake and Lakehead. Dunsmuir rain and freeze dates and summer trout stocking: Dunsmuir. 103 in. of snow: Mount Shasta, California. The 1959 Ski Bowl record and the late April to October climbing season: Mount Shasta. Hatchery mid-March to July: CDFW. Carnevale: Weed. Shasta Valley summers and winters: Montague. Gold Rush Days in June and 11.6 in. of snow from Nov to Feb: Yreka. The Oct 17, 2024 Chinook: Klamath River. Siskiyou Summit snow Nov to Apr: Siskiyou Summit. The arid farm valley below Iron Gate and the bend south to meet I-5: Course of the Klamath River.

## Trivia

- **682 (conveyor)**: "why" now says "then the largest".
- **687 (Kennett)**: confirmed and unchanged.
- **689 (Pit River name)**: "why" now says "traps for game that came to drink at the river". The source does not mention deer.
- **691 (bridge height)**: "why" now says "within about 40 feet of the bridge", to match the source.
- **731 (Babe Ruth)**: distractor Ty Cobb replaced with Willie Mays. Cobb was active and barnstorming in 1924, so he was not clearly wrong.
- **733 (Shasta soda), 738 (1959 storm), 740 (14,179 ft), 770 (every Thursday), 773 (BAKERY), 786 (four dams)**: answers confirmed and unchanged.
- **747 (Abner Weed)**: distractor "A railroad junction" replaced with "Rich soil for orchards". Weed is a rail junction today, which could mislead.
