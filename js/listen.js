// I-5 Buddy: push-to-talk voice commands. Tap the mic, say "what's on my left", "next gas",
// "how far to Redding", "how much time is left", "tell me about Harris Ranch", "what's that castle",
// "what's growing here", "be quiet"... The microphone is only on while the listening panel is open (never
// always-on). Replies are spoken and captioned under the header. "That castle" or "those trees" only ever means a
// place near us; narration that comes up while the mic is open waits and plays after the reply.
//
// parseCommand(), chooseCommand() and parseAnswer() are pure (no DOM, no api) and are tested in
// tools/test-listen.html. Everything that touches the page runs only after init(api).

/* =========================================================================================
   Text helpers (pure)
   ========================================================================================= */

/** Lowercase plain words: "What's on my RIGHT?" -> "what is on my right", "1,926 ft." -> "1926 ft". */
export function normText(s) {
  let t = String(s == null ? "" : s).toLowerCase();
  try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch { /* very old engine */ }
  return t
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/&/g, " and ")
    .replace(/\b(what|where|how|that|it|there|who|here|when|why)'s\b/g, "$1 is")
    .replace(/\blet's\b/g, "let us")
    .replace(/\bi'm\b/g, "i am")
    .replace(/\b(you|we|they)'re\b/g, "$1 are")
    .replace(/\b(\w+)n't\b/g, (m, w) => (w === "ca" ? "cannot" : w === "wo" ? "will not" : w + " not"))
    .replace(/\b(i|you|we|they)'(ll|d|ve)\b/g, (m, w, x) => `${w} ${x === "ll" ? "will" : x === "d" ? "would" : "have"}`)
    .replace(/'/g, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/(^|[^0-9])\./g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

// Wake words and politeness around a command ("hey buddy, could you tell me more please").
const LEAD = /^(?:hey|hi|hello|ok|okay|yo|so|um+|uh+|uhm|er+|erm|hmm+|well|please|buddy|i ?5 buddy|i five buddy|can you|could you|would you|will you|can i|could i|may i|i want to|i would like to|i wanna|i need you to|let us|just|and|now|alright|all right) /;
const TAIL = / (?:please|buddy|thanks|thank you|for me|for us|real quick|ok|okay)$/;
function stripFill(t) {
  for (let i = 0; i < 6; i++) {
    const s = t.replace(LEAD, "").replace(TAIL, "");
    if (s === t || !s) break;
    t = s;
  }
  return t;
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stem = w => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

/** Same word, allowing plurals and (strict = false) one or two typos from the recognizer. */
function tokEq(a, b, strict) {
  if (a === b || stem(a) === stem(b)) return true;
  if (strict || /\d/.test(a) || /\d/.test(b) || Math.min(a.length, b.length) < 4) return false;
  return lev(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1);
}

const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNumWord = w => w in SMALL || w in TENS;
/** Spoken numbers to digits: "one hundred fourteen years" -> "114 years", "nineteen twenty six" -> "1926", "nine point five" -> "9.5". */
export function numWords(t) {
  const w = String(t || "").split(" ").filter(Boolean), out = [];
  let i = 0;
  while (i < w.length) {
    if (!isNumWord(w[i]) && !(w[i] === "a" && w[i + 1] === "hundred")) { out.push(w[i++]); continue; }
    let total = 0, cur = 0;
    while (i < w.length) {
      const x = w[i];
      if (x === "a" && w[i + 1] === "hundred" && cur === 0) { cur = 1; i++; continue; }
      if (x in SMALL) {
        const v = SMALL[x];
        if (cur === 0) cur = v;
        else if (cur % 100 >= 20 && cur % 10 === 0 && v < 10) cur += v;          // twenty six
        else if (cur >= 100 && cur % 100 === 0) cur += v;                          // one hundred fourteen
        else if (cur >= 10 && cur < 100 && v >= 10) { total += cur * 100; cur = v; } // nineteen nineteen
        else break;
      } else if (x in TENS) {
        const v = TENS[x];
        if (cur === 0) cur = v;
        else if (cur >= 100 && cur % 100 === 0) cur += v;
        else if (cur >= 10 && cur < 100) { total += cur * 100; cur = v; }          // nineteen twenty
        else break;
      } else if (x === "hundred") cur = (cur || 1) * 100;
      else if (x === "thousand") { total += (cur || 1) * 1000; cur = 0; }
      else if (x === "and" && isNumWord(w[i + 1] || "") && (cur >= 100 || total >= 1000)) { /* one hundred and ten */ }
      else break;
      i++;
    }
    out.push(String(total + cur));
  }
  return out.join(" ").replace(/\b(\d+) point (\d+)\b/g, "$1.$2");
}

/* =========================================================================================
   Destinations and places (pure)
   ========================================================================================= */

// How people say (and recognizers spell) the cities in DESTS. Keys are normText(name). Places past the road the app
// covers (Seattle, the Canadian border...) stay listed: they find those places in WHOLE_ROAD below, and the real
// destinations again when tools/build.py covers more of I-5.
const DEST_ALIASES = {
  "mexico border": ["mexico", "mexican border", "us mexico border", "tijuana", "san ysidro", "the mexican border"],
  "canadian border": ["canada", "canada border", "us canada border", "blaine", "british columbia", "bc", "b c", "peace arch", "vancouver bc", "vancouver b c", "vancouver canada"],
  "downtown los angeles": ["los angeles", "la", "l a", "downtown la", "downtown l a"],
  "vancouver wa": ["vancouver", "vancouver washington"],
  "mount shasta": ["mt shasta", "mount shasta city", "mt shasta city"],
  "mount vernon": ["mt vernon"],
  "kettleman city": ["kettleman"],
  "yreka": ["why reka", "y reka", "eureka", "wireka", "yrika"],
  "redding": ["reading", "reding"],
  "grapevine": ["tejon pass", "grapevine pass"],
  "sacramento": ["sac", "sacto", "sac town", "sactown"],
  "los banos": ["los banyos", "lost banos", "los bonos"],
  "grants pass": ["grant pass"],
  "coalinga": ["coal inga", "colinga", "kolinga"],
  "roseburg": ["roseberg"],
  "everett": ["everet", "evert"],
  "seattle": ["seatle"],
  "tacoma": ["takoma"],
  "olympia": ["oly"],
  "anaheim": ["anna heim"],
  "mount saint helens": ["mount st helens", "mt st helens", "mt saint helens", "saint helens", "st helens"],
  "mount rainier": ["mt rainier", "mount ranier", "mt ranier", "rainier"],
  "crater lake": ["crater lake national park"],
  "siskiyou summit": ["siskiyou pass"],
  "corvallis": ["corvalis"],
  "baja california": ["baja", "baja california norte"],
  "rosarito": ["rosarito beach", "playas de rosarito"],
};

// The rest of I-5, and what lies past its ends, for when the app covers only part of the road (data.STATES, from
// tools/build.py SCOPE): "how far to Portland" then gets "Portland is past the Oregon line" instead of "I don't know".
// The first names are the whole road's DESTS, so the same words find the real destination whenever the data has it.
// [name, where it is: a state on I-5, or "BC" / "MX" past either end of the road]
const WHOLE_ROAD = [
  ["Ashland", "OR"], ["Medford", "OR"], ["Grants Pass", "OR"], ["Roseburg", "OR"], ["Eugene", "OR"], ["Albany", "OR"], ["Salem", "OR"],
  ["Portland", "OR"], ["Vancouver, WA", "WA"], ["Longview", "WA"], ["Centralia", "WA"], ["Olympia", "WA"], ["Tacoma", "WA"], ["Seattle", "WA"],
  ["Everett", "WA"], ["Mount Vernon", "WA"], ["Bellingham", "WA"], ["Canadian border", "BC"],
  // more towns on the road and sights near it (in no DESTS list, even for the whole road)
  ["Siskiyou Summit", "OR"], ["Central Point", "OR"], ["Rogue River", "OR"], ["Canyonville", "OR"], ["Cottage Grove", "OR"], ["Springfield", "OR"],
  ["Corvallis", "OR"], ["Woodburn", "OR"], ["Wilsonville", "OR"], ["Tigard", "OR"], ["Crater Lake", "OR"], ["Klamath Falls", "OR"], ["Mount Hood", "OR"],
  ["Kelso", "WA"], ["Chehalis", "WA"], ["Burlington", "WA"], ["Mount Rainier", "WA"], ["Mount Saint Helens", "WA"],
  ["Ensenada", "MX"], ["Rosarito", "MX"], ["Baja California", "MX"],
];
const WHERE = new Map(WHOLE_ROAD.map(([n, st]) => [normText(n), st]));
let roadMemo = { key: null, list: [] };
/** The DESTS names plus the WHOLE_ROAD places they don't have. */
function roadDests(names) {
  const key = names.join("|");
  if (roadMemo.key === key) return roadMemo.list;
  const have = new Set(names.map(normText));
  roadMemo = { key, list: names.concat(WHOLE_ROAD.map(w => w[0]).filter(n => !have.has(normText(n)))) };
  return roadMemo.list;
}
/** A WHOLE_ROAD place that DESTS doesn't have, named anywhere in t ("tell me about Seattle"), or null. */
function pastIn(t, names) {
  const have = new Set(names.map(normText));
  for (const d of destIndex(WHOLE_ROAD.map(w => w[0]).filter(n => !have.has(normText(n))))) {
    if (d.alias.length >= 4 && new RegExp(`\\b${escRe(d.alias)}\\b`).test(t)) return d.name;
  }
  return null;
}

const destMemo = new Map(); // a few lists take turns (DESTS, DESTS plus WHOLE_ROAD, the places past the road)
function destIndex(names) {
  const key = names.join("|");
  if (destMemo.has(key)) return destMemo.get(key);
  const idx = [];
  for (const name of names) {
    const base = normText(name);
    const al = new Set([base, base.replace(/^downtown /, ""), base.replace(/ (wa|or|ca)$/, ""), base.replace(/ city$/, ""), base.replace(/ border$/, "")]);
    if (/^mount /.test(base)) al.add(base.replace(/^mount /, "mt "));
    for (const a of DEST_ALIASES[base] || []) al.add(a);
    for (const a of al) if (a) idx.push({ alias: a, flat: a.replace(/ /g, ""), name });
  }
  idx.sort((a, b) => b.alias.length - a.alias.length);
  if (destMemo.size >= 6) destMemo.delete(destMemo.keys().next().value);
  destMemo.set(key, idx);
  return idx;
}

const BORDER_Q = /^(border|border crossing|that border)$/;
/**
 * A city from DESTS for the spoken target ("the mexican border", "reading", "sacramento california"), or null.
 * "The border" is the one ahead: the Mexico border going south; going north, the other border in the list (the
 * Oregon border when the app covers California, the Canadian border for the whole road).
 */
export function matchDest(q, names, dir = "N") {
  if (!q || !names || !names.length) return null;
  q = q.replace(/^(the|a) /, "");
  if (BORDER_Q.test(q)) {
    const borders = names.filter(n => /border$/i.test(n));
    return (dir === "S" ? borders.find(n => /mexic/i.test(n)) : borders.filter(n => !/mexic/i.test(n)).pop()) || null;
  }
  const idx = destIndex(names), flat = q.replace(/ /g, "");
  for (const d of idx) if (d.alias === q || d.flat === flat) return d.name;
  let best = null;
  for (const d of idx) {
    if (d.flat.length < 5) continue;
    const L = Math.max(d.flat.length, flat.length), dist = lev(d.flat, flat);
    if (dist <= (L >= 8 ? 2 : 1) && (!best || dist < best.dist)) best = { dist, name: d.name };
  }
  if (best) return best.name;
  const words = q.split(" ").length;
  for (const d of idx) {
    if (d.alias.length >= 4 && new RegExp(`\\b${escRe(d.alias)}\\b`).test(q) && words <= d.alias.split(" ").length + 2) return d.name;
  }
  return null;
}

// Words that never identify a place on their own.
const STOP = new Set(("the a an of and or in on at to for by with from is are was were be been am it its this that these those my our your " +
  "me us i we you they them their he she his her what where how when who why which do does did can could would will should there here " +
  "please tell show give know about more much many some any anything something see get go going need want like just now then also too " +
  "very really okay ok yes no not have has had one ones around near nearby ahead behind today right left side sides lane way bit lot " +
  "thing things stuff kind sort over under up down out across past front coming passing looking seeing look called").split(" "));
// Words that say what kind of place something is rather than which one ("lake", "orchards", "that tower").
// Alone they only pick out a place near us; plurals count too.
const GENERIC = new Set(("next nearest closest rest area areas stop station gas food exit exits city town lake lakes river park state national historic " +
  "mount mt old new north south east west county valley bridge dam ranch hill hills creek falls road route freeway highway interstate " +
  "place places landmark thing big little great first san santa el la los las del de st saint cafe preserve refuge reserve " +
  "tower tree orchard grove field plant water canal peak mountain fort mission bay castle train factory factories statue cow cattle " +
  "story stories history building barn farm crop smoke median overpass interchange split crossing grade summit pass tunnel " +
  "airport museum church temple").split(" "));
const isGen = w => GENERIC.has(w) || GENERIC.has(stem(w));
function toks(s) {
  return String(s || "").split(" ").filter(w => w && !STOP.has(w)).map(w => ({ w, g: isGen(w) }));
}
let placeMemo = { key: null, list: [] };
function placeIndex(names) {
  if (placeMemo.key === names) return placeMemo.list;
  placeMemo = {
    key: names,
    list: names.map(name => {
      const t = toks(normText(name));
      const spec = t.filter(x => !x.g);
      // "Weed, a windy lumber town": the part before the comma is what people call it
      const core = /, /.test(name) ? toks(normText(name.split(", ")[0])) : null;
      return { name, toks: t, core: core && core.length ? core : null, allGen: t.length > 0 && !spec.length, // "Tower Bridge", "Mission Bay"
        head: spec.length ? spec[spec.length - 1].w : null }; // "Lake Shasta Caverns" -> caverns
    }),
  };
  return placeMemo.list;
}

/**
 * Best place name for a spoken target. Returns {name, cands (all equally good names), score} or null.
 * A single word must be spelled right and be a good part of the name: "cows" is not "Crows Landing airfield", and
 * "tower" alone is not "Tower Bridge" (a name made only of generic words must be said in full).
 */
export function matchPlace(q, names, strict = false) {
  if (!q || !names || !names.length) return null;
  const qt = toks(normText(q));
  if (!qt.length) return null;
  const one = qt.length === 1;
  if (one) strict = true;
  let best = [], bestScore = 0;
  for (const P of placeIndex(names)) {
    if (!P.toks.length) continue;
    const wt = x => (x.g && !P.allGen ? 1 : 2);
    let hit = 0, hitD = 0, qW = 0;
    for (const x of qt) {
      const w = wt(x);
      qW += w;
      if (P.toks.some(y => tokEq(x.w, y.w, strict))) { hit += w; if (w === 2) hitD++; }
    }
    if (!hitD) continue;
    const prec = hit / qW;
    if (prec < 0.75) continue;
    const recOf = list => Math.min(1, hit / list.reduce((a, y) => a + wt(y), 0));
    const rec = Math.max(recOf(P.toks), P.core && P.core.every(y => qt.some(x => tokEq(x.w, y.w, strict))) ? recOf(P.core) : 0);
    // one word out of a long name is too weak, unless it is the name's main word ("the caverns")
    if (rec < (one ? (P.head && tokEq(qt[0].w, P.head, true) ? 0.4 : 0.5) : 0.3)) continue;
    if (P.allGen && rec < 1) continue;
    const sc = prec * 0.6 + rec * 0.4;
    if (sc > bestScore + 1e-6) { best = [P.name]; bestScore = sc; } else if (Math.abs(sc - bestScore) <= 1e-6) best.push(P.name);
  }
  return bestScore >= 0.55 ? { name: best[0], cands: best, score: bestScore } : null;
}

// Too vague to pick out anything in sight ("what's that place", "this area").
const VAGUE = new Set("place places area areas spot thing things stretch part region landmark landmarks one".split(" "));
/**
 * A place in sight, for "what's that castle" or "those trees on the left": the word for the thing (the last one said)
 * must be in the name of a place near us, spelled right, on the side the user named. "Next" or "nearest" means a
 * kind of stop ("the next rest area"), which the services commands answer instead.
 * @param {string} q what was said after "what's that", "tell me about"...
 * @param {Array<string|{name: string, side?: string, d?: number}>} near places near us (side "left"|"right"|"", d = miles ahead)
 * @param {"left"|"right"|null} side the side the user named, if any
 */
export function matchNear(q, near, side = null) {
  if (!q || !Array.isArray(near) || !near.length) return null;
  const qt = toks(normText(q)).filter(x => !VAGUE.has(x.w));
  if (!qt.length || qt.some(x => /^(next|nearest|closest)$/.test(x.w))) return null;
  const head = qt[qt.length - 1].w;
  let best = null;
  for (const n of near) {
    const obj = n && typeof n === "object";
    const name = obj ? n.name : n;
    if (!name) continue;
    const s = obj ? n.side || "" : "";
    if (side && s && s !== side) continue;
    const nt = toks(normText(name));
    if (!nt.some(y => tokEq(head, y.w, true))) continue;
    const hits = qt.filter(x => nt.some(y => tokEq(x.w, y.w, true))).length;
    if (hits * 2 < qt.length) continue;
    const d = obj && isFinite(n.d) ? Math.abs(n.d) : 0;
    const sc = hits / nt.length + hits / qt.length - Math.min(d, 20) / 40;
    if (!best || sc > best.sc) best = { name, sc };
  }
  return best ? { name: best.name, cands: [best.name], score: best.sc } : null;
}

const DEIXIS = /^(that|this|those|these)\b/;
// "this valley", "this town": where we are, not a landmark
const HERE_WORDS = new Set("valley town city county state area region place road freeway highway stretch spot".split(" "));
/**
 * A place for a spoken target, the way people say it in a car. "That castle" or "those trees" is something in sight,
 * so only a place near us will do (or nothing, and the question falls through to "what's around"). A kind of thing
 * ("the bridge") also needs a place near us. One specific word ("the aqueduct", "Shasta") prefers a place near us,
 * then anywhere. A longer name ("Harris Ranch", "the olive pits") is looked up everywhere.
 */
function findPlace(q, places, near, side, strict) {
  const s0 = String(q || "").trim();
  const s = s0.replace(/^(?:(?:the|a|an|that|this|those|these|about) )+/, "").trim();
  const qt = toks(s);
  if (!qt.length) return null;
  if (/^(this|these)\b/.test(s0) && HERE_WORDS.has(stem(qt[qt.length - 1].w))) return null;
  if (DEIXIS.test(s0)) return matchNear(s, near, side);
  if (qt.length === 1) return matchNear(s, near, side) || (qt[0].g ? null : matchPlace(s, places, true));
  if (qt.every(x => x.g)) return matchNear(s, near, side) || matchPlace(s, places, true);
  return matchPlace(s, places, strict);
}

/** "left" | "right" | null: a side the user named. "Right now", "all right" and "how much time is left" are not sides. */
const NOT_SIDE = /\b(right (now|here|away|there|then)|all right|alright|that is right|you are right|right on|(time|miles?|hours?|minutes?|much|long|far)( is| are)? left|left (to go|over))\b/g;
function sideSaid(t) {
  const m = t.match(/\b(?:the|my|your|our|to|on) (left|right)\b/); // "on the right there", "to my left"
  if (m) return m[1];
  const tl = t.replace(NOT_SIDE, " ");
  const iL = tl.search(/\b(left|lefthand|left hand)\b/), iR = tl.search(/\b(right|write|rite|righthand|right hand)\b/);
  if (iL < 0 && iR < 0) return null;
  return iR < 0 || (iL >= 0 && iL < iR) ? "left" : "right";
}

const STATE_IDS = { california: "CA", oregon: "OR", washington: "WA" };
/**
 * A state line as a target: "Oregon", "the Oregon border", "Washington state", "the state line" (= the next one).
 * Whether the app covers that state is the runtime's business (stateLineText): on the California road, "Oregon" is
 * the end of the road and "Washington" lies past it.
 */
function stateTarget(q) {
  const s = String(q || "").replace(/^(the|a) /, "");
  const m = s.match(/^(?:state of )?(california|oregon|washington)(?: state)?(?: (?:state )?(?:border|line|state line))?$/);
  if (m) return STATE_IDS[m[1]];
  return /^(?:next )?state ?(?:line|border)$|^next state$/.test(s) ? "next" : null;
}
// "The end of the road", "the end of I-5": the end of the covered road in the direction of travel.
const END_Q = /^(?:very )?end(?: of (?:the )?(?:road|line|i 5|interstate|freeway|highway))?$/;

/* =========================================================================================
   Command parser (pure)
   ========================================================================================= */

const OFF = /\b(off|stop|stopping|pause|disable|quiet|silence|end|no more|shut off|cancel|kill|deactivate|not|less)\b/;
const ON = /\b(on|start|resume|enable|back|continue|begin|activate|restart|keep|more)\b/;
const DIST_TRIG = /\b(how far|how much (longer|farther|further|more)|how long|how many (more )?(miles|minutes|hours)|how (close|near)|distance|when (do|will|are|should|can) we|where is|where are|take me|navigate|drive me|directions|the way|head(ing|ed)? (to|for)|we are going|going to|destination|eta)\b/;
const T_LEAD = new Set(("is it to till til until we get getting do does will would reach reaching arrive arriving arrival in at be away from here for " +
  "before there still more longer farther further of drive driving going go us me the a an set destination up much many miles minutes hours by are " +
  "left time close closer near almost nearly cross crossing into enter entering hit how long").split(" "));
const T_TAIL = /(?: (?:from here|from us|from where we are|away|yet|now|still|please|left|to go|exactly|again|right now|by car|driving|is|are|located|on i 5|on the freeway|on the highway|from me|anymore))+$/;
function target(rest) {
  const w = String(rest || "").trim().split(" ").filter(Boolean);
  while (w.length && T_LEAD.has(w[0])) w.shift();
  return w.join(" ").replace(T_TAIL, "").trim();
}
/** Extra flags for a distance question: ask = only asking (keep the trip's destination), eta = they want a clock time. */
function distFlags(trig) {
  const f = {};
  if (/^(where|how (close|near)|are we)/.test(trig)) f.ask = true;
  if (/^(what time|when|eta|arrival)/.test(trig)) f.eta = true;
  return f.ask || f.eta ? f : undefined;
}
const MORE_TRIG = /\b(tell me (more |a story |the story |a little |something |a bit |all )?(about|on|regarding)|(more|story|stories|history|info|information|facts?) (about|on|of|behind|regarding)|what is|what are|what was|what were|who is|who was|who were|learn about|know about|describe|explain)\b/g;
/** "Tell me about X", "what's that X": the place named after the last trigger that names anything. */
function moreTarget(t, o, strict, side) {
  MORE_TRIG.lastIndex = 0;
  const ms = [...t.matchAll(MORE_TRIG)];
  for (let i = ms.length - 1; i >= 0; i--) {
    const q = t.slice(ms[i].index + ms[i][0].length).trim();
    if (!toks(q).length) continue; // "tell me about it": nothing named after this one
    const p = findPlace(q, o.places, o.near, side, strict);
    return p ? { cmd: "more", arg: p.name, cands: p.cands } : null;
  }
  return null;
}
const HOWFAR = new RegExp("\\b(how far|how much (longer|farther|further|more)|how long (until|till|til|to|before|is it|will it be|do we have)|" +
  "how (close|near) (are we|is it)|are we (getting )?(there|close|closer|near|nearly there|almost there)|almost there|there yet|" +
  "how many (more )?(miles|minutes|hours)|distance (to|from)|when (do|will|are|should) we (get|arrive|reach|be|cross|hit)|" +
  "what time (do|will|would|should) we|eta|(time|miles?|hours?|minutes?|how much|how long)( is| are)? left|left to go|miles to go|arrival)\\b");
// "is Redding far", "is it much farther", "are we close"
const IS_FAR = /^(?:is|are) (.+?) (?:still )?(?:far|close|near|nearby|close by|much farther|much further|a long way)(?: away| from here| off| still)?$/;
// Questions about the land itself: crops, trees, hills, "this area"
const LAND = new RegExp("\\b(what (is|are) (they |we |people )?(growing|farming|planting)|what (crops?|kind of (crops?|trees?|farms?|farming|orchards?|plants?|fields?|cows|cattle))|" +
  "(what (is|are)|tell me about|what about|describe) (that|this|those|these|the|all (the|these|those)) (trees?|orchards?|groves?|fields?|crops?|plants?|" +
  "vines?|vineyards?|farms?|farmland|cows|cattle|hills?|mountains?|valley|land|area|region|stretch|landscape|scenery|countryside)|" +
  "what is out here|the (landscape|scenery|countryside))\\b");
const LAND_FARM = /\b(grow|growing|farming|planting|crops?|trees?|orchards?|groves?|fields?|plants?|vines?|vineyards?|farms?|farmland|cows|cattle)\b/;
const TAB = { map: "map", maps: "map", passport: "passport", stamps: "passport", badges: "passport", game: "play", games: "play", bingo: "play", play: "play", "i spy": "play", drive: "drive", driving: "drive", home: "drive", ahead: "ahead", list: "ahead" };

/**
 * Turn what was heard into a command. Pure: same input, same output.
 * @param {string} text what the recognizer heard
 * @param {string[]} destNames DESTS names ("Sacramento", "Oregon border", ...)
 * @param {{places?: string[], dir?: "N"|"S", near?: Array<{name: string, side?: string, d?: number}>}} opts place names
 *   (for "tell me about X", "how far to X"), travel direction, and the places near us (for "what's that castle")
 * @returns {{cmd: string, arg: any, q?: string, partial?: boolean, cands?: string[], ask?: boolean, eta?: boolean, st?: string, past?: string}}
 *   cmd is "unknown" when nothing fits. For "howfar": ask = only asking (keep the destination), eta = wants a clock time,
 *   st = a state line ("CA" | "OR" | "WA" | "next") or an end of the road ("N" | "S"), past = a WHOLE_ROAD place
 *   that DESTS doesn't have ("Portland" when the app covers California).
 */
export function parseCommand(text, destNames = [], opts = {}) {
  const t = stripFill(normText(text));
  const out = (cmd, arg = null, extra) => (extra ? Object.assign({ cmd, arg }, extra) : { cmd, arg });
  if (!t) return out("unknown");
  const has = re => re.test(t);
  const dests = Array.isArray(destNames) ? destNames : [];
  const o = { places: (opts && Array.isArray(opts.places) && opts.places) || [], near: (opts && Array.isArray(opts.near) && opts.near) || [] };
  const dir = opts && opts.dir === "S" ? "S" : "N";
  const side = sideSaid(t);
  let m;
  // A state line ("how far to Oregon", "the state line"), an end of the road ("the border", "the end of the road"),
  // a city ("how far to Redding"), a place past the road the app covers ("how far to Seattle") or a landmark
  // ("where is the Olive Pit").
  const resolve = (q, flags) => {
    const f = extra => Object.assign({}, flags, extra);
    const st = stateTarget(q);
    if (st) return out("howfar", null, f({ st }));
    const bare = q.replace(/^(the|a) /, "");
    if (END_Q.test(bare)) return out("howfar", null, f({ st: dir }));
    const border = BORDER_Q.test(bare);
    const pool = border ? dests : roadDests(dests); // "the border" is one of the road's own ends
    const trail = bare.match(/^(.+?) (?:california|oregon|washington)$/); // "salem oregon" is Salem, not the Oregon border
    const d = (trail && matchDest(trail[1], pool, dir)) || matchDest(q, pool, dir);
    if (d && dests.includes(d)) {
      const line = stateTarget(normText(d)); // "Oregon border": the state line at the end of the road, not a city
      return line ? out("howfar", null, f({ st: line })) : out("howfar", d, flags);
    }
    if (d) return out("howfar", null, f({ past: d }));
    if (border) return out("howfar", null, f({ st: dir }));
    const p = findPlace(q, o.places, o.near, side, false);
    return p ? out("distance", p.name, { cands: p.cands }) : null;
  };

  // never mind
  if (has(/^(cancel( that| it)?|never ?mind|nevermind|forget (it|that|about it)|nothing|no|nope|no thanks|no thank you|not now|stop listening|dismiss|close( this| it)?|exit|go away|done|all done|that is (all|it))$/)) return out("cancel");

  // narration on / off (before "stop" and "quiet")
  if (has(/\b(narration|narrating|narrate|narrator|commentary|announcements?|announcing|tour guide)\b/) || has(/\b(start|keep|resume) talking\b/) || has(/\b(un ?mute|mute)\b/)) {
    if (has(/\bun ?mute\b/)) return out("narr", true);
    if (has(/\bmute\b/) || has(OFF)) return out("narr", false);
    if (has(ON)) return out("narr", true);
    return out("narr", null);
  }

  // be quiet (the strong forms win over everything below)
  if (has(/\b(shut up|be quiet|quiet|keep quiet|stop talking|stop it|stop that|silence|hush|shush|sh+|zip it|cut it out|stop stop|ok stop|okay stop|no more talking|enough talking)\b/) || has(/^(that is |thats )?enough( already)?$|^no more$/)) return out("quiet");

  // settings by voice
  if (has(/\b(kid|kids|kiddo|children|child|family|i spy) ?mode\b/)) return out("kid", has(OFF) ? false : has(ON) ? true : null);
  if (has(/\b(story time|story mode|more stories|talk more|be (more )?chatty|chattier)\b/)) return out("chat", "high");
  if (has(/\b(talk less|less chatty|less talking|only (the )?big (stuff|things)|big stuff only|just the big (stuff|things)|fewer announcements|not so chatty|too chatty|too much talking)\b/)) return out("chat", "low");
  if (has(/\b(normal|regular) (chat|chattiness|chatter|mode|talking)\b/)) return out("chat", "normal");
  if (has(/\b(auto|automatic|day and night|day night) ?(mode|theme)\b/)) return out("theme", "auto");
  if (has(/\b(dark|night|nighttime|night time) ?(mode|theme|screen|colou?rs?)\b|\b(darker|too bright)\b/)) return out("theme", "dark");
  if (has(/\b(light|day|daytime|day time|bright) ?(mode|theme|screen|colou?rs?)\b|\b(brighter|lighter|too dark)\b/)) return out("theme", "light");

  // trip control
  if (has(/\b(end|stop|finish|quit|exit|cancel|close|turn off|kill|done with)( the| this| my| our)? (trip|drive|driving|road trip|journey|gps|tracking|demo|demo drive|navigation)\b/)) return out("end");
  if (has(/\b(start|begin|run|take|do|try|play)( the| a| my)? demo( drive| mode)?\b|^demo( drive| mode)?$/)) return out("start", "demo");
  if (has(/\b(start|begin|turn on|use|enable|switch on|open)( the| a| my| our| a new)? (gps|tracking|location|trip|drive|driving|road trip|journey)\b/)) return out("start", "gps");

  // speaking speed and volume
  if (!has(/\b(traffic|going|driving|am i|are we|fast food)\b/)) {
    if (has(/\btoo (slow|slowly)\b/)) return out("rate", "faster");
    if (has(/\btoo (fast|quick|quickly)\b/)) return out("rate", "slower");
    if (has(/\b(slower|more slowly|slow down|slow it down|slow)\b/)) return out("rate", "slower");
    if (has(/\b(faster|more quickly|speed up|speed it up|quicker|hurry up|fast)\b/)) return out("rate", "faster");
  }
  if (has(/\b(louder|volume|quieter|softer|speak up|turn (it |yourself |the sound )?(up|down)|can(not)? hear (you|it|anything)|too (loud|quiet|soft))\b/)) return out("volume");

  // games and fun
  if ((m = t.match(/^(?:(?:the |my |final )?answer(?: is)?|option|letter|choice|pick|choose|is it|it is|i think it is|i say|i will go with|go with) ?(a|b|c|d|e|f|bee|be|see|sea|dee)$|^(a|b|c|d|bee|see|sea|dee)$/))) {
    return out("answer", LETTER_WORDS.findIndex(v => v.includes(m[1] || m[2])));
  }
  if ((m = t.match(/^(?:the )?(first|second|third|fourth|last) (?:one|answer|option|choice)$/))) {
    return out("answer", { first: 0, second: 1, third: 2, fourth: 3, last: 3 }[m[1]]);
  }
  if (has(/\b(next|another|different|new) (trivia )?question\b|\bskip (the |this )?question\b/)) return out("trivia", "next");
  if (has(/\b(repeat|read|say|reread) (me )?(the |that )?question( again)?\b|\bwhat (was|is) the question\b/)) return out("trivia", "read");
  if (has(/\b(trivia|quiz|ask me (a |some |something|anything)|ask a question|question for me|test me)\b/)) return out("trivia");
  if (has(/\b(jokes?|make me laugh|something funny|funny)\b/)) return out("joke");

  // "is Redding far", "is it far"
  if ((m = t.match(IS_FAR))) {
    const q = target(m[1]);
    if (!q || /^(it|that|this|there|we|us)$/.test(q)) return out("howfar");
    const r = resolve(q, { ask: true });
    if (r) return r;
  }
  // a named city or place: "how far to Redding", "where is Harris Ranch", "tell me about the Olive Pit"
  if ((m = t.match(DIST_TRIG))) {
    const q = target(t.slice(m.index + m[0].length));
    if (q) {
      const r = resolve(q, distFlags(m[0]));
      if (r) return r;
    }
  }
  const strictMore = moreTarget(t, o, true, side);
  if (strictMore) return strictMore;

  if (has(/\b(fun fact|a fact|tell me (a |another )?story|another story|something interesting|interesting fact|tell me something|entertain me|i am bored|we are bored|bored)\b/)) return out("story");
  if (has(/\b(stamps?|passport|badges?)\b/) && has(/\b(how many|count|progress|score|so far|collected|got|have i|do i have|do we have|have we|total|number of)\b/)) return out("stamps");
  if (has(/\b(settings|preferences|setup|options menu)\b/)) return out("settings");

  // tabs (and which game, for Play)
  const game = w => (w === "bingo" ? { game: "bingo" } : w === "i spy" ? { game: "spy" } : undefined);
  if ((m = t.match(/\b(?:show|open|go to|goto|switch to|take me to|bring up|pull up|view|display|let me see|i want to see|back to|go back to)\b(?:\s+\w+){0,3}?\s+(maps?|passport|stamps|badges|games?|bingo|play|i spy|drive|driving|home|ahead|list)\b/))) return out("tab", TAB[m[1]], game(m[1]));
  if ((m = t.match(/^(?:the )?(maps?|passport|bingo|games?|i spy)(?: tab| screen| page| view| card)?$/))) return out("tab", TAB[m[1]], game(m[1]));
  if ((m = t.match(/\b(?:play|start) (?:a |some )?(games?|bingo|i spy)\b/))) return out("tab", "play", game(m[1]));

  if (has(/\b(next|upcoming|nearest|closest|coming|what|which) exit\b|\bexit (is )?(next|coming up|ahead)\b|\bexit number\b/)) return out("exit");

  // services: the order matters ("charging station" is EV, "truck stop" is fuel, "rest stop" is a rest area)
  if (has(/\b(ev|e v|evs|electric|chargers?|charging|charge|superchargers?|tesla|plug in|plugin)\b/)) return out("services", "ev");
  if (has(/\b(gas|gasoline|fuel|petrol|diesel|fill up|refuel|refueling|gas station|filling station|truck stop|unleaded|chevron|shell|arco|exxon|mobil|valero)\b/)) return out("services", "fuel");
  if (has(/\b(rest ?areas?|rest ?stops?|rest ?rooms?|bathrooms?|toilets?|potty|pee|peeing|loo|washroom|lavatory|comfort station|(take|need|want) a break|stretch (my|our) legs)\b/)) return out("services", "rest");
  if (has(/\b(hotels?|motels?|sleep|sleeping|lodging|lodge|inn|place to stay|somewhere to stay|room for the night|tired|sleepy|drowsy|bed)\b/)) return out("services", "sleep");
  if (has(/\b(food|eat|eating|hungry|starving|starved|restaurants?|lunch|dinner|breakfast|brunch|supper|snacks?|coffee|cafe|burgers?|pizza|tacos?|fast food|drive thru|drive through|in n out|in and out|starbucks|mcdonalds|meal|bite to eat|grab a bite)\b/)) return out("services", "food");

  // live road info
  if (has(/\b(freeway|message|electronic|overhead|highway|road) signs?\b|\bwhat (does|do) the (next )?signs? say\b|\bnext sign\b/)) return out("sign");
  if (has(/\b(weather|forecast|rain|raining|rainy|snow|snowing|snowy|temperature|how hot|how cold|hot outside|cold outside|storms?|stormy|fog|foggy|windy|wind|sunny|degrees|umbrella|ice|icy|heat)\b/)) return out("weather");
  if (has(/\b(traffic|chains?|chain control|road conditions?|conditions|closures?|closed|accidents?|crash|road ?work|construction|alerts?|delays?|jam|congestion|warnings?)\b/)) return out("road");

  if (has(/\b(elevation|altitude|how high|above sea level|how far up|feet up)\b/)) return out("elevation");
  if (has(/\b(how fast|what is (our|my|the) speed|our speed|my speed|current speed|speedometer|what speed|speed)\b/)) return out("speed");

  // how far (no named city, or one I don't know): "how much time is left", "what time will we get to Redding"
  if ((m = t.match(HOWFAR))) {
    const q = target(t.slice(m.index + m[0].length));
    const flags = distFlags(m[0]);
    if (q && !/^(it|that|this|there|here|we|us)$/.test(q)) return resolve(q, flags) || out("howfar", null, { q, partial: true });
    return out("howfar", null, flags && flags.eta ? { eta: true } : undefined);
  }

  if (has(/\b(where are we|where am i|where (is|are) (this|here)|where we at|what (state|town|city|county|area|region|mile|milepost|mile marker|road|highway|freeway)( is this| are we( in| on| at)?| am i( in| on| at)?| is it)?|what is (this|the name of this) (town|city|county|state)|our location|my location|current location|location|whereabouts|which (state|town|city)|what milepost)\b/)) return out("where");

  // left / right ("right now", "all right" and "time left" are not directions)
  if (side) return out("look", side);

  // the land itself: "what's growing here", "what are those trees", "tell me about this area"
  if (has(LAND)) return out("land", has(LAND_FARM) ? "farm" : "land");

  if (has(/\b(repeat|say (that|it) again|say again|again|what was that|what did you (just )?say|come again|pardon|one more time|did not (hear|catch|get)|missed (that|it)|replay)\b/) || has(/^(what|huh|sorry|excuse me|pardon me|sorry what|what what)$/)) return out("repeat");

  // a place named loosely ("tell me about pea soup andersons")
  const looseMore = moreTarget(t, o, false, side);
  if (looseMore) return looseMore;

  if (has(/\b(tell me more|more about (it|that|this|them|there)|more info|more information|more details|details|keep going|go on|continue|and then|what else|tell me about (it|that|this|that place|this place|them|there|the place|this one|that one)|tell me the story|the story|go deeper|elaborate|expand|explain|learn more|know more|hear more|more please)\b/) || has(/\bmore\b/)) return out("more");
  if (has(/\b(next|skip|coming up|up next|upcoming|another (one|place|landmark)|something else|what is ahead|ahead|move on)\b/)) return out("next");
  if (has(/\b(stop|pause|wait|hold on|hang on|okay okay|enough|no more|quiet down)\b/)) return out("quiet");
  if (has(/\b(what is (that|this|here|there|around|out there|over there|nearby|near us|near here|close by|this place|that place|it)|what am i (looking at|seeing)|what are (we|those|these|they)( passing| looking at| seeing)?|what are those|what did we (just )?(pass|see|drive by|go by)|anything (interesting|nearby|around|here|cool|to see)|what is around|around here|around us|nearby|near here|what is out( the)? window|look around|what do (i|we) see|what can (i|we) see)\b/)) return out("around");
  if (has(/^(play|play it|play that|read it|read that|read|announce|announce it|hear it|play (the )?(card|landmark|announcement))$/)) return out("announce");
  if (has(/\b(help|what can (i|you) (say|do|ask)|what (do|should|can) i (say|ask)|commands?|options|how does (this|it) work|how (do|does) (i|this|you) (use|work)|what do you do|instructions|tutorial|what are you)\b/)) return out("help");
  if (has(/\b(thanks|thank you|thank u|thx|cheers|appreciate (it|you)|good job|great job|well done|nice job|you are (great|awesome|the best))\b/)) return out("thanks");
  if (has(/^(hi|hello|hey|hey there|hi there|hello there|howdy|yo|good (morning|afternoon|evening)|buddy|are you there|you there|can you hear me|testing|test|is this working|mic check)$/)) return out("hello");
  // a place past the road the app covers, named in any words ("tell me about Seattle"): say where the road ends
  const far = pastIn(t, dests);
  if (far) return out("howfar", null, { past: far });
  return out("unknown");
}

/** Pick the best command over the recognizer's alternatives: a fully resolved one beats a partial one. */
export function chooseCommand(alts, destNames = [], opts = {}) {
  let first = null;
  for (const a of alts || []) {
    const c = parseCommand(a, destNames, opts);
    if (c.cmd === "unknown") continue;
    if (!c.partial) return Object.assign(c, { heard: a });
    if (!first) first = Object.assign(c, { heard: a });
  }
  return first || { cmd: "unknown", arg: null, heard: (alts && alts[0]) || "" };
}

/* =========================================================================================
   Trivia answers (pure)
   ========================================================================================= */

const LETTER_WORDS = [["a", "ay", "eh", "hey", "aye", "ey"], ["b", "be", "bee", "bea", "bi"], ["c", "see", "sea", "si", "cee", "she"],
  ["d", "dee", "de", "di"], ["e", "ee"], ["f", "ef", "eff"]];
const ORDINALS = [["first", "1st"], ["second", "2nd"], ["third", "3rd"], ["fourth", "4th", "forth"], ["fifth", "5th"], ["sixth", "6th"]];
const ANS_LEAD = /^(?:um+|uh+|er+|hmm+|well|so|okay|ok|i think|i guess|i believe|i say|i will say|i would say|i will go with|i will take|i am going with|i am gonna go with|i pick|i choose|go with|is it|it is|it must be|it has to be|maybe|probably|definitely|my answer is|the answer is|answer is|my final answer is|final answer|my guess is|how about|what about|please) /;
const ANS_TAIL = / (?:please|final answer|is my final answer|i think|maybe|is my answer|is the answer|right|correct)$/;
const ANS_STOP = new Set("a an the of in it is its to and or on at by for with like".split(" "));
const sig = s => s.split(" ").filter(w => w && !ANS_STOP.has(w));

/**
 * Which choice did they say? Understands "B", "bee", "answer C", "the second one", "number 3", "the last one",
 * or the answer itself ("Bing Crosby", "crosby", "eighteen months"). Returns the index, or null if unsure.
 */
export function parseAnswer(text, choices) {
  const n = Array.isArray(choices) ? choices.length : 0;
  if (!n) return null;
  const raw = normText(text);
  let t = raw;
  for (let i = 0; i < 5; i++) { const s = t.replace(ANS_LEAD, "").replace(ANS_TAIL, ""); if (s === t || !s) break; t = s; }
  if (!t || /^(i do not know|i have no idea|no idea|pass|skip( it)?|not sure|dunno|i give up|give up|cancel|never ?mind|nothing)$/.test(t)) return null;
  const tn = numWords(t), rn = numWords(raw);
  const cs = choices.map(c => numWords(normText(c)));
  const bare = s => s.replace(/^(a|an|the) /, "");

  // 1. the answer itself
  for (let i = 0; i < n; i++) if (cs[i] && (cs[i] === tn || cs[i] === rn || bare(cs[i]) === bare(tn))) return i;

  // 2. a letter: "b", "bee", "answer c", "letter d as in dog"
  const lm = tn.match(/^(?:answer|option|letter|choice|the letter|pick|choose|say|its) ?([a-z]+)(?: as in \w+)?(?: one)?$/) || tn.match(/^([a-z]+)(?: as in \w+)?$/);
  if (lm) {
    const w = lm[1], li = LETTER_WORDS.findIndex(v => v.includes(w));
    if (li >= 0 && li < n) {
      const hits = w.length > 1 ? cs.map((c, i) => (c.split(" ").includes(w) ? i : -1)).filter(i => i >= 0) : [];
      return hits.length === 1 ? hits[0] : li;
    }
  }

  // 3. order: "the second one", "number 3", "the last one"
  const om = tn.match(/\b(?:number|option|choice|answer) (\d)\b/);
  if (om && +om[1] >= 1 && +om[1] <= n) return +om[1] - 1;
  for (let k = 0; k < Math.min(n, ORDINALS.length); k++) if (ORDINALS[k].some(w => new RegExp(`\\b${w}\\b`).test(tn))) return k;
  if (/\b(last|bottom)( one)?\b/.test(tn)) return n - 1;
  if (/\btop( one)?\b/.test(tn)) return 0;

  // 4. a whole choice inside a longer sentence ("i think it was bing crosby")
  let best = -1, bestLen = 0;
  for (let i = 0; i < n; i++) {
    const c = bare(cs[i]);
    if (c.length >= 2 && new RegExp(`(^| )${escRe(c)}( |$)`).test(tn) && c.length > bestLen) { best = i; bestLen = c.length; }
  }
  if (best >= 0) return best;

  // 5. the words that make a choice different ("crosby", "months", "bakery")
  const ut = sig(tn);
  if (ut.length) {
    const scores = cs.map(c => {
      const ct = sig(c);
      if (!ct.length) return 0;
      let s = 0;
      for (const w of ct) {
        if (ut.includes(w)) s += 1;
        else if (ut.some(u => tokEq(u, w, false))) s += 0.75;
      }
      return s / ct.length;
    });
    const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
    if (order[0][0] > 0 && (order.length < 2 || order[0][0] >= order[1][0] * 1.3 + 0.01)) return order[0][1];
  }

  // 6. a bare number means "the Nth one" when the choices are not numbers themselves
  if (!cs.some(c => /\d/.test(c))) {
    const bm = tn.match(/^(?:the )?(\d|for)(?: one)?$/);
    if (bm) { const k = bm[1] === "for" ? 3 : +bm[1] - 1; if (k >= 0 && k < n) return k; }
  }
  return null;
}

/* =========================================================================================
   Runtime: the mic button, the listening panel, captions, and running commands
   ========================================================================================= */

const SILENCE_MS = 7000;      // stop after this long without new words
const MAX_MS = 20000;         // never listen longer than this
const ANSWER_MAX_MS = 10000;  // trivia waits 15 s for an answer, so settle well before that
const START_WAIT_MS = 30000;  // time to answer the browser's microphone prompt
const RUN_DELAY = 320;        // let the phone switch the audio back from the mic before speaking
const GUARD_MS = 850;         // after we stop the voice, voice.js may still be inside that item's chime (up to ~0.75 s)
const NEAR_BACK = 3, NEAR_AHEAD = 15; // "that castle" means a place this close (miles behind / ahead)
const LETTERS = "ABCDEF";

let A = null;                 // the app api
let ov = null;                // overlay root
const ui = {};                // overlay parts
let banner = null;            // reply caption
let sess = null, sid = 0;     // the recognition session
let mode = "command";         // "command" | "answer" | "help"
let answer = null;            // {choices, resolve, question, pick?}
let blocked = false;          // microphone refused: voice commands off for this session
let held = [];                // [{id, text, place?}] narration stopped for the microphone, queued again after our reply
let heldAt = 0;               // when we last stopped the voice (see GUARD_MS)
let holding = false;          // voice.hold(true) is in effect (when voice.js offers it)
const queuedAnn = new Map();  // place id -> place: landmark announcements the narrator queued and hasn't started
let lastContent = null;       // last thing the app said that was not one of our own short lines
let lastSpokeMine = false;
let lastSpeech = null;        // {id, t}: whatever started speaking last
let lastPlace = null;         // {p, t}: the place we last talked about (spoken, or looked at)
let lastAnnounced = null;     // the place the narrator queued last (it may not have been spoken)
let expectReply = null;       // {head, until}: caption the next thing spoken
let asyncReply = false;       // the command being run answers later (live data)
let cmdSeq = 0;               // counts commands, so a late answer can tell the user moved on
let returnFocus = null;
const told = new Set();
let jokeIdx = 0;
const timers = {};

const warn = e => { try { console.warn("[listen]", e); } catch {} };
const getSR = () => (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
const isMine = id => typeof id === "string" && id.startsWith("listen:");
const now = () => Date.now();
function later(name, ms, fn) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => { timers[name] = null; try { fn(); } catch (e) { warn(e); } }, ms);
}
function clear(...names) { for (const n of names) { clearTimeout(timers[n]); timers[n] = null; } }
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svg(path, cls) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "currentColor");
  s.append(p);
  return s;
}
const ICON = {
  mic: "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z",
  ok: "M9.2 16.6 4.6 12l-1.6 1.6 6.2 6.2L21 8l-1.6-1.6L9.2 16.6Z",
  off: "M19 11h-2c0 .74-.16 1.43-.43 2.05l1.5 1.5A6.9 6.9 0 0 0 19 11Zm-4 .17V5a3 3 0 0 0-5.94-.6L15 10.34v.83ZM4.27 3 3 4.27l6 6V11a3 3 0 0 0 4.27 2.72l1.66 1.66A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08c.9-.13 1.75-.42 2.52-.84L19.73 21 21 19.73 4.27 3Z",
  q: "M11 18h2v-2h-2v2Zm1-16a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm0-14a4 4 0 0 0-4 4h2a2 2 0 1 1 4 0c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 0 0-4-4Z",
  x: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z",
};

/* ---------- small views of the app data (all guarded: data may be partial) ---------- */
const D = () => (A && A.data) || {};
const S = () => (A && A.S) || {};
const N = () => (A && A.narrator) || null;
let destNamesMemo = null, placeNamesMemo = null;
function destNames() {
  if (!destNamesMemo) destNamesMemo = (Array.isArray(D().DESTS) ? D().DESTS : []).map(d => d && d.name).filter(Boolean);
  return destNamesMemo;
}
function placeNames() {
  if (!placeNamesMemo) placeNamesMemo = (Array.isArray(D().PLACES) ? D().PLACES : []).map(p => p && p.name).filter(Boolean);
  return placeNamesMemo;
}
const places = () => (Array.isArray(D().PLACES) ? D().PLACES : []);
const ahead = (x) => (S().dir === "S" ? S().m - x : x - S().m);
const sideOf = p => { try { return D().sideWord ? D().sideWord(p, S().dir) : ""; } catch { return ""; } };
/** Places close enough to be "that castle": a few miles behind us to 15 ahead, with their side of the road. */
function nearPlaces() {
  const out = [];
  if (S().m == null) return out;
  for (const p of places()) {
    if (!p || !p.name || !isFinite(p.m)) continue;
    const d = ahead(p.m);
    if (d > -NEAR_BACK && d < NEAR_AHEAD) out.push({ name: p.name, side: sideOf(p), d });
  }
  return out;
}
const parseOpts = () => ({ places: placeNames(), dir: S().dir, near: nearPlaces() });
const exitName = (st, ref) => { try { return D().exitName(st, ref); } catch { return `Exit ${ref}`; } };
const dur = hrs => { try { return D().fmtDuration ? D().fmtDuration(hrs) : ""; } catch { return ""; } };
const fmtNum = n => { try { return Number(n).toLocaleString("en-US"); } catch { return String(n); } };
function listJoin(a) { return a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`; }
function shortDest(name) {
  const s = String(name || "").replace(/^Downtown /, "").replace(/, [A-Z]{2}$/, "");
  return /border$/i.test(s) ? `the ${s}` : s;
}
function placeById(id) {
  try { if (D().placeById) return D().placeById(id) || null; } catch {}
  return places().find(p => p.id === id) || null;
}
function placeFromSpeechId(id) {
  if (!id || typeof id !== "string") return null;
  return placeById(id.replace(/^(hear|more|look|story):/, ""));
}
/** A place by (one of) its names, nearest to us when several share a name. */
function resolvePlace(name, cands) {
  const want = new Set([name, ...(cands || [])].filter(Boolean).map(normText));
  const list = places().filter(p => want.has(normText(p.name)));
  if (list.length < 2 || S().m == null) return list[0] || null;
  const rank = p => { const d = ahead(p.m); return d >= -0.5 ? d : 1000 - d; };
  return list.sort((a, b) => rank(a) - rank(b))[0];
}
/**
 * The place the user most likely means by "tell me more": the one we last talked about (spoken or looked at, in the
 * last 3 minutes), else the one on the Drive card, else the last one the narrator queued.
 */
function currentPlace() {
  if (lastPlace && now() - lastPlace.t < 3 * 60e3) return lastPlace.p;
  let card = null;
  try { if (S().m != null && N() && N().upcoming) card = (N().upcoming(S().m, S().dir, null) || [])[0]; } catch {}
  return (card && card.p) || lastAnnounced || null;
}
/** A city to use in examples ("How far to Coalinga?"): the trip's destination, else the next one 25+ miles ahead. Never a border. */
function exampleDest() {
  const list = Array.isArray(D().DESTS) ? D().DESTS.filter(d => d && d.name) : [];
  if (S().dest && S().dest.name && !/border/i.test(S().dest.name)) return S().dest;
  if (!list.length) return null;
  if (S().m != null) {
    const nxt = list.filter(d => !/border/i.test(d.name) && ahead(d.m) > 25).sort((a, b) => ahead(a.m) - ahead(b.m))[0];
    if (nxt) return nxt;
  }
  return list.find(d => d.name === "Sacramento") || list.find(d => !/border/i.test(d.name)) || list[0];
}

/* =========================================================================================
   The overlay
   ========================================================================================= */

function buildOverlay() {
  ov = h("div", "lsn");
  ov.id = "listenOverlay";
  ov.hidden = true;
  const scrim = h("div", "lsn-scrim");
  const panel = h("section", "lsn-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "lsnTitle");
  panel.tabIndex = -1;

  const orb = h("div", "lsn-orb");
  for (let i = 0; i < 3; i++) { const w = h("i", "lsn-wave"); w.setAttribute("aria-hidden", "true"); orb.append(w); }
  const core = h("button", "lsn-core");
  core.type = "button";
  core.append(svg(ICON.mic, "ic ic-mic"), svg(ICON.ok, "ic ic-ok"), svg(ICON.q, "ic ic-q"), svg(ICON.off, "ic ic-off"));
  orb.append(core);

  const title = h("h2", "lsn-title", "Listening…");
  title.id = "lsnTitle";
  title.setAttribute("aria-live", "polite"); // state changes are announced; every interim word would be noise
  const said = h("p", "lsn-said");
  const hint = h("p", "lsn-hint");
  const question = h("p", "lsn-q");
  const choices = h("ol", "lsn-choices");
  const help = h("div", "lsn-help");
  const tryBox = h("div", "lsn-try");
  const exs = h("div", "lsn-exs");
  const all = h("button", "link lsn-all", "All commands");
  all.type = "button";
  tryBox.append(h("h3", "lsn-sub", "Try saying"), exs, all);
  const acts = h("div", "lsn-acts");
  const again = h("button", "primary lsn-again", "Try again");
  again.type = "button";
  const cancel = h("button", "secondary lsn-cancel", "Cancel");
  cancel.type = "button";
  acts.append(again, cancel);
  // head = the ring and what we heard; body = examples, answers or the command list. One column on a phone held
  // upright; side by side on a phone on its side (css/listen.css).
  const head = h("div", "lsn-head");
  head.append(orb, title, said, hint, question);
  const body = h("div", "lsn-body");
  body.append(choices, help, tryBox);
  panel.append(head, body, acts);
  ov.append(scrim, panel);
  document.body.append(ov);
  Object.assign(ui, { panel, head, body, orb, core, title, said, hint, question, choices, help, tryBox, exs, all, again, cancel });

  ov.addEventListener("click", e => { if (!panel.contains(e.target)) dismiss(); });
  cancel.addEventListener("click", () => dismiss());
  again.addEventListener("click", () => { if (mode === "help") listenNow("command"); else listenNow(mode); });
  all.addEventListener("click", () => openHelp(false));
  core.addEventListener("click", () => {
    const st = ov.dataset.state;
    if (st === "listening" || st === "starting") { if (sess) stopRec(sess); }
    else if ((st === "unknown" || st === "error") && mode !== "answer") listenNow("command");
    else if (mode === "help") listenNow("command");
  });
  ov.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); dismiss(); return; }
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll("button:not([disabled])")].filter(b => b.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  });
}

function openOverlay(m) {
  if (!ov) buildOverlay();
  mode = m;
  clear("hide", "close");
  ov.classList.remove("out");
  if (ov.hidden) {
    const a = document.activeElement;
    returnFocus = a && a !== document.body && !ov.contains(a) ? a : null;
  }
  ov.hidden = false;
  ov.dataset.mode = m;
  delete ov.dataset.hear;
  ui.said.textContent = "";
  ui.hint.textContent = "";
  ui.question.hidden = true;
  ui.choices.hidden = m !== "answer";
  ui.help.hidden = m !== "help";
  ui.tryBox.hidden = m !== "command";
  if (m === "command") fillExamples();
  if (m === "answer") fillChoices();
  if (m === "help") fillHelp();
  syncBody();
  const btn = document.getElementById("micBtn");
  if (btn) btn.setAttribute("aria-expanded", "true");
  try { ui.panel.scrollTop = 0; ui.panel.focus({ preventScroll: true }); } catch {}
}
/** Hide the body when nothing in it is showing (so it adds no gap). */
function syncBody() { if (ui.body) ui.body.hidden = ui.choices.hidden && ui.help.hidden && ui.tryBox.hidden; }

/**
 * Close the panel and stop listening. Held narration is queued again, unless a command is about to run (it does that
 * after its reply) or keep is set (a chip tap runs its command right after this).
 */
function closeOverlay(keep = false) {
  if (sess) abortRec();
  const picked = !!(answer && answer.pick != null);
  resolveAnswer(null); // a picked answer still goes through (see pickAnswer)
  clear("close", "early", "wait");
  if (picked) later("release", 0, () => releaseVoice()); // after trivia has queued its verdict
  else if (!keep && !timers.run) releaseVoice();
  const btn = document.getElementById("micBtn");
  if (btn) btn.setAttribute("aria-expanded", "false");
  if (!ov || ov.hidden) return;
  ov.classList.add("out");
  later("hide", 140, () => { ov.hidden = true; ov.classList.remove("out"); });
  const back = returnFocus && document.contains(returnFocus) ? returnFocus : btn && !btn.hidden ? btn : null;
  returnFocus = null;
  try { if (back && ov.contains(document.activeElement)) back.focus({ preventScroll: true }); } catch {}
}
const dismiss = () => closeOverlay();
function autoClose(ms) { if (!(A && A.listen && A.listen.debug && A.listen.debug.hold)) later("close", ms, closeOverlay); }

// [title, hint, tone]: "soft" = nothing went wrong really (muted), "hard" = something needs fixing (red)
const ERR = {
  "no-speech": ["I didn't hear anything", "Tap Try again, then talk while the ring is pulsing.", "soft"],
  network: ["Voice commands need a connection on this phone", "Everything else keeps working offline.", "hard"],
  "audio-capture": ["I can't reach the microphone", "Another app may be using it. Close that app and try again.", "hard"],
  "language-not-supported": ["Voice commands aren't available in this language here", "Try again later, or use the buttons.", "hard"],
  unsupported: ["This browser can't do voice commands", "Use the buttons instead.", "hard"],
  generic: ["Listening stopped", "Tap Try again.", "soft"],
};

/** Paint one state of the panel. state: starting | listening | waiting | done | unknown | error | help */
function setState(state, o = {}) {
  if (!ov) return;
  ov.dataset.state = state;
  const answerMode = mode === "answer";
  let title = o.title, hint = o.hint, icon = "mic", label = "Stop listening";
  if (state === "starting" || state === "listening") {
    title = title || (answerMode ? "Say your answer" : "Listening…");
    if (hint == null) hint = answerMode ? `Say ${letterList(answer ? answer.choices.length : 4)}, or the answer itself.` : "";
  } else if (state === "done") { icon = "ok"; label = "Done"; }
  else if (state === "unknown") { icon = "q"; label = "Try again"; }
  else if (state === "error") { icon = "off"; label = "Try again"; }
  else if (state === "help") { title = "Things you can say"; hint = "Tap one to try it, or tap Talk and say it."; label = "Talk"; }
  if (state === "error") ov.dataset.tone = o.tone || "hard"; else delete ov.dataset.tone;
  ui.title.textContent = title || "";
  ui.hint.textContent = hint || "";
  if (o.said != null) setSaid(o.said, "");
  ui.core.dataset.icon = icon;
  ui.core.setAttribute("aria-label", label);
  const settled = state === "done" || blocked || (answerMode && (state === "unknown" || state === "error"));
  ui.core.disabled = settled;
  const retry = (((state === "unknown" || state === "error") && !answerMode) || state === "help") && !blocked;
  ui.again.hidden = !retry;
  ui.again.textContent = state === "help" ? "Talk" : "Try again";
  ui.cancel.textContent = o.close || (state === "starting" || state === "listening" ? "Cancel" : "Close");
  ui.tryBox.hidden = mode !== "command" || blocked;
  syncBody();
  for (const b of ui.choices.querySelectorAll(".lsn-choice")) b.disabled = state !== "starting" && state !== "listening";
  if (retry) try { ui.again.focus({ preventScroll: true }); } catch {}
}
function letterList(n) { const l = LETTERS.slice(0, Math.max(1, Math.min(n, 6))).split(""); return l.length < 2 ? l[0] : `${l.slice(0, -1).join(", ")} or ${l[l.length - 1]}`; }
function setSaid(fin, int) {
  ui.said.textContent = "";
  ui.said.classList.toggle("is-int", !fin);
  if (!fin && !int) return;
  ui.said.append("“");
  if (fin) ui.said.append(fin);
  if (int) ui.said.append(h("span", "int", (fin ? " " : "") + int));
  ui.said.append("”");
}
function bump() {
  if (!ui.orb) return;
  ui.orb.classList.remove("bump");
  void ui.orb.offsetWidth;
  ui.orb.classList.add("bump");
  later("bump", 160, () => ui.orb.classList.remove("bump"));
}

function chip(text, c, cls = "lsn-ex") {
  const b = h("button", cls, text);
  b.type = "button";
  b.addEventListener("click", () => tapRun(c));
  return b;
}
function examples() {
  const d = exampleDest();
  const list = [["What's on my left?", { cmd: "look", arg: "left" }], ["Tell me more", { cmd: "more" }], ["Where are we?", { cmd: "where" }]];
  if (d) list.push([`How far to ${shortDest(d.name)}?`, { cmd: "howfar", arg: d.name }]);
  list.push(["Next gas", { cmd: "services", arg: "fuel" }]);
  if (A.live && typeof A.live.weatherText === "function") list.push(["What's the weather?", { cmd: "weather" }]);
  else if (A.play && typeof A.play.askTrivia === "function") list.push(["Ask me trivia", { cmd: "trivia" }]);
  list.push(["Be quiet", { cmd: "quiet" }]);
  return list;
}
function fillExamples() {
  ui.exs.textContent = "";
  for (const [t, c] of examples()) ui.exs.append(chip(t, c));
}
function fillChoices() {
  ui.choices.textContent = "";
  const a = answer;
  if (!a) return;
  if (a.question) { ui.question.textContent = a.question; ui.question.hidden = false; }
  a.choices.forEach((c, i) => {
    const li = h("li");
    const b = h("button", "lsn-choice");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.append(h("b", null, LETTERS[i]), h("span", null, c));
    b.addEventListener("click", () => pickAnswer(i, null));
    li.append(b);
    ui.choices.append(li);
  });
}
function helpGroups() {
  const d = exampleDest();
  const s = (A && A.settings) || {};
  const g = [
    ["Around you", [["What's on my left?", { cmd: "look", arg: "left" }], ["What's on my right?", { cmd: "look", arg: "right" }], ["What's that?", { cmd: "around" }],
      ["What's growing here?", { cmd: "land", arg: "farm" }], ["Tell me more", { cmd: "more" }], ["Say that again", { cmd: "repeat" }], ["Next one", { cmd: "next" }]]],
    ["Your trip", [["Where are we?", { cmd: "where" }], ...(d ? [[`How far to ${shortDest(d.name)}?`, { cmd: "howfar", arg: d.name }]] : []),
      ["How much time is left?", { cmd: "howfar" }], ...endRow(),
      ["Next exit", { cmd: "exit" }], ["How high are we?", { cmd: "elevation" }], ["How fast are we going?", { cmd: "speed" }]]],
    ["Stops", [["Next gas", { cmd: "services", arg: "fuel" }], ["EV charger", { cmd: "services", arg: "ev" }], ["Food", { cmd: "services", arg: "food" }],
      ["Hotel", { cmd: "services", arg: "sleep" }], ["Rest area", { cmd: "services", arg: "rest" }]]],
    ["My voice", [["Be quiet", { cmd: "quiet" }], ["Slower", { cmd: "rate", arg: "slower" }], ["Faster", { cmd: "rate", arg: "faster" }],
      [s.narr === false ? "Narration on" : "Narration off", { cmd: "narr", arg: s.narr === false }], ["Only the big stuff", { cmd: "chat", arg: "low" }], ["Story time", { cmd: "chat", arg: "high" }]]],
    ["Fun", [...(A.play && typeof A.play.askTrivia === "function" ? [["Ask me trivia", { cmd: "trivia" }]] : []), ["Tell me a joke", { cmd: "joke" }],
      ["Fun fact", { cmd: "story" }], ["How many stamps?", { cmd: "stamps" }], ["Show the map", { cmd: "tab", arg: "map" }]]],
  ];
  if (A.live) g.splice(3, 0, ["Live road info", [["What's the weather?", { cmd: "weather" }], ["Road conditions", { cmd: "road" }], ["What do the signs say?", { cmd: "sign" }]]]);
  return g;
}
/** The next state line when the app covers more than one state, else the north end of the road ("How far to Oregon?"). */
function endRow() {
  const n = statesList().length;
  if (n > 1) return [["How far to the state line?", { cmd: "howfar", arg: null, st: "next" }]];
  return n ? [[`How far to ${ends().N.short}?`, { cmd: "howfar", arg: null, st: "N" }]] : [];
}
function fillHelp() {
  ui.help.textContent = "";
  for (const [name, rows] of helpGroups()) {
    const sec = h("section", "lsn-group");
    sec.append(h("h3", "lsn-sub", name));
    const ul = h("ul");
    for (const [t, c] of rows) { const li = h("li"); li.append(chip(t, c, "lsn-cmd")); ul.append(li); }
    sec.append(ul);
    ui.help.append(sec);
  }
}
function openHelp(speak) {
  if (sess) abortRec();
  resolveAnswer(null);
  clear("close");
  openOverlay("help");
  setState("help");
  if (speak) {
    const d = exampleDest();
    say(`You can say: what's on my left, tell me more, where are we, ${d ? `how far to ${shortDest(d.name)}` : "next exit"}, next gas, or be quiet. The full list is on screen.`, "help");
  }
}

/* =========================================================================================
   Recognition
   ========================================================================================= */

/** Open the panel and start listening. Called from a tap (iOS needs the gesture). */
function start() {
  try {
    if (blocked) { openOverlay("command"); showBlocked("not-allowed"); return false; }
    if (sess && ov && !ov.hidden && mode === "command") { stopRec(sess); return true; }
    quietVoice();
    try { A.voice && A.voice.unlock && A.voice.unlock(); } catch (e) { warn(e); }
    resolveAnswer(null);
    openOverlay("command");
    return beginRec("command");
  } catch (e) { warn(e); releaseVoice(); return false; }
}
function listenNow(m) {
  if (m === "answer" && !answer) m = "command";
  if (m === "command") { quietVoice(); try { A.voice.unlock(); } catch {} }
  openOverlay(m);
  return beginRec(m);
}

function beginRec(m) {
  const C = getSR();
  if (!C) { setState("error", errState("unsupported")); releaseVoice(); return false; }
  if (sess) abortRec();
  const s = { id: ++sid, rec: null, mode: m, alts: [], fin: "", int: "", err: null, cancelled: false, stopping: false, ended: false, live: false };
  try {
    s.rec = new C();
    s.rec.lang = "en-US";
    s.rec.interimResults = true;
    s.rec.maxAlternatives = 3;
    s.rec.continuous = false;
  } catch (e) { warn(e); setState("error", errState("generic")); releaseVoice(); return false; }
  sess = s;
  const on = (name, fn) => { s.rec[name] = ev => { if (sess !== s) return; try { fn(ev); } catch (e) { warn(e); } }; };
  const live = () => {
    if (s.live) return;
    s.live = true;
    clear("startwatch");
    setState("listening");
    later("silence", SILENCE_MS, () => stopRec(s));
    later("hard", m === "answer" ? ANSWER_MAX_MS : MAX_MS, () => stopRec(s));
  };
  on("onstart", live);
  on("onaudiostart", live);
  on("onsoundstart", () => { live(); ov.dataset.hear = "1"; });
  on("onspeechstart", () => { live(); ov.dataset.hear = "1"; });
  on("onresult", ev => { live(); onResult(s, ev); });
  on("onerror", ev => {
    s.err = (ev && ev.error) || "generic";
    if (s.err === "not-allowed" || s.err === "service-not-allowed") finish(s);
  });
  on("onend", () => finish(s));
  setState("starting");
  try { s.rec.start(); }
  catch (e) {
    s.err = /notallowed|not.?allowed|denied|permission/i.test(String(e && (e.name + " " + e.message))) ? "not-allowed" : "generic";
    finish(s);
    return false;
  }
  later("startwatch", START_WAIT_MS, () => stopRec(s));
  return true;
}

function onResult(s, ev) {
  const res = ev && ev.results;
  if (!res) return;
  const n = res.length >>> 0;
  let K = 1;
  for (let i = 0; i < n; i++) K = Math.max(K, (res[i] && res[i].length) >>> 0);
  const alts = [];
  for (let k = 0; k < Math.min(K, 5); k++) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const r = res[i], a = r && (r[k] || r[0]);
      const tx = a && a.transcript ? String(a.transcript).trim() : "";
      if (tx && parts[parts.length - 1] !== tx) parts.push(tx); // Chrome on Android can repeat a segment
    }
    const j = parts.join(" ").trim();
    if (j && !alts.includes(j)) alts.push(j);
  }
  let fin = "", int = "", allFinal = n > 0;
  for (let i = 0; i < n; i++) {
    const r = res[i], tx = r && r[0] && r[0].transcript ? String(r[0].transcript).trim() : "";
    if (!r || !r.isFinal) allFinal = false;
    if (!tx) continue;
    if (r.isFinal) fin += (fin ? " " : "") + tx; else int += (int ? " " : "") + tx;
  }
  s.alts = alts; s.fin = fin; s.int = int;
  setSaid(fin, int);
  bump();
  later("silence", SILENCE_MS, () => stopRec(s));
  if (allFinal) { s.final = true; stopRec(s); return; }
  // Some phones keep listening after a clear command; act on a confident one after a short pause.
  const text = (fin + " " + int).trim();
  const pause = s.mode === "answer" ? (parseAnswer(text, answer ? answer.choices : []) != null ? 1100 : 0) : earlyPause(text);
  if (pause) later("early", pause, () => stopRec(s)); else clear("early");
}
// A phrase that stops on one of these words isn't finished ("where's the next", "how far to").
const UNFINISHED = /\b(to|the|my|on|about|is|for|of|a|an|me|and|or|how|what|where|far|in|at|from|by|with|our|your|are|do|does|can|could|will|would|any|some|than)$/;
// These finish a command but often lead into a longer one ("what's the next … rest area", "play … bingo"): wait longer.
const LEADS_ON = /\b(next|nearest|closest|another|play|more)$/;
/** How long a pause after these words means they're done talking (ms), or 0 to wait for the recognizer. */
function earlyPause(text) {
  const c = parseCommand(text, destNames(), parseOpts());
  const t = normText(text);
  if (c.cmd === "unknown" || c.partial || UNFINISHED.test(t)) return 0;
  if (LEADS_ON.test(t)) return 2600;
  return / /.test(t) ? 1400 : 1900; // one word: a breath before the rest is common
}

function stopRec(s) {
  if (!s || sess !== s || s.stopping) return;
  s.stopping = true;
  clear("silence", "hard", "early", "startwatch");
  try { s.rec.stop(); } catch (e) { warn(e); }
  later("endwatch", 2500, () => { try { s.rec.abort(); } catch {} finish(s); });
}
/** Stop without acting on anything (Cancel, tap outside, app hidden). */
function abortRec() {
  const s = sess;
  if (!s) return;
  s.cancelled = true;
  try { s.rec.abort(); } catch {}
  finish(s);
}

function finish(s) {
  if (!s || s.ended) return;
  s.ended = true;
  if (sess === s) sess = null;
  clear("silence", "hard", "endwatch", "early", "startwatch");
  try { for (const k of ["onstart", "onaudiostart", "onsoundstart", "onspeechstart", "onresult", "onerror", "onend"]) s.rec[k] = null; } catch {}
  if (ov) delete ov.dataset.hear;
  if (s.cancelled) return;
  const err = s.err;
  if (err === "not-allowed" || err === "service-not-allowed") { onBlocked(err); return; }
  const alts = s.alts.length ? s.alts : [(s.fin + " " + s.int).trim()].filter(Boolean);
  if (!alts.length) {
    const code = !err || err === "no-speech" ? "no-speech" : ERR[err] ? err : "generic";
    showError(code);
    return;
  }
  if (s.mode === "answer") gotAnswer(alts); else gotCommand(alts);
}

function errState(code) { const e = ERR[code] || ERR.generic; return { title: e[0], hint: e[1], tone: e[2] }; }
function showError(code) {
  if (!ov || ov.hidden) { resolveAnswer(null); releaseVoice(); return; }
  setState("error", errState(code));
  if (code === "no-speech" || code === "network") say(ERR[code][0] + ".", "err");
  if (mode === "answer") { resolveAnswer(null); autoClose(2200); } else autoClose(9000);
  releaseVoice(); // after our line, so it isn't cut by it
}

// After these, narration that waited for the microphone is dropped (the user asked for quiet, or a new start).
const DROPS_HELD = new Set(["quiet", "narr", "end", "start", "trivia"]);
function gotCommand(alts) {
  const c = chooseCommand(alts, destNames(), parseOpts());
  const heard = c.heard || alts[0];
  if (c.cmd === "unknown") {
    setState("unknown", { title: "Sorry, I didn't catch that.", hint: "Try: what's on my left.", said: heard });
    say("Sorry, I didn't catch that. Try: what's on my left.", "unknown");
    releaseVoice();
    autoClose(9000);
    return;
  }
  if (c.cmd === "cancel") { closeOverlay(); return; }
  if (c.cmd === "help") { openHelp(true); releaseVoice(); return; }
  setState("done", { title: label(c), said: normText(label(c)) === normText(heard) ? "" : heard });
  later("run", Math.max(RUN_DELAY, guardWait()), () => runThenRelease(c, { heard }));
  autoClose(800);
}
/** Run a command, then queue the narration that waited for the microphone behind its reply. */
function runThenRelease(c, meta) {
  if (run(c, meta) !== "later") releaseVoice(DROPS_HELD.has(c.cmd));
}

function gotAnswer(alts) {
  const list = answer ? answer.choices : [];
  let idx = null, heard = alts[0];
  for (const a of alts) { const i = parseAnswer(a, list); if (i != null) { idx = i; heard = a; break; } }
  if (idx == null) {
    // Settle now: the caller (trivia) has its own way to retry, and its own timeout. Trivia stays quiet on null.
    setState("unknown", { title: "I didn't catch an answer", hint: `Say ${letterList(list.length)} next time, or tap an answer.`, said: heard });
    say("I didn't catch an answer.", "noanswer");
    resolveAnswer(null);
    releaseVoice();
    autoClose(1800);
    return;
  }
  pickAnswer(idx, heard);
}
function pickAnswer(i, heard) {
  if (!answer || answer.pick != null) return;
  if (sess) abortRec();
  const c = answer.choices[i];
  [...ui.choices.querySelectorAll(".lsn-choice")].forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
  setState("done", { title: `${LETTERS[i]}: ${c}`, said: heard && normText(heard) !== normText(c) ? heard : "" });
  answer.pick = i;
  // Trivia speaks its verdict as soon as the answer resolves (and that interrupts everything queued), so the held
  // narration is queued in the next task, behind the verdict.
  const go = () => { resolveAnswer(i); later("release", 0, () => releaseVoice()); };
  const wait = guardWait();
  if (wait > 0) later("pick", wait, go); else go();
  autoClose(Math.max(700, wait + 150));
}
function resolveAnswer(v) {
  const a = answer;
  if (!a) return;
  answer = null;
  clear("pick");
  try { a.resolve(v == null && a.pick != null ? a.pick : v); } catch (e) { warn(e); }
}

/**
 * Listen for a trivia answer. Call it from a tap (iOS only opens the microphone inside a gesture): it stops any
 * speech and listens right away. choices: the answer texts in order; opts.question is shown above them.
 * Resolves within about 12 seconds with the choice index, or null (cancelled, not understood, no microphone).
 */
function listenForAnswer(choices, opts = {}) {
  return new Promise(resolve => {
    try {
      const list = Array.isArray(choices) ? choices.slice(0, 6).map(c => String(c == null ? "" : c)) : [];
      if (!list.length || blocked || !getSR()) { resolve(null); return; }
      if (sess) abortRec();
      resolveAnswer(null);
      quietVoice();
      try { A.voice && A.voice.unlock && A.voice.unlock(); } catch (e) { warn(e); }
      answer = { choices: list, resolve, question: opts && opts.question ? String(opts.question) : "" };
      openOverlay("answer");
      if (!beginRec("answer")) resolveAnswer(null);
    } catch (e) { warn(e); resolve(null); releaseVoice(); }
  });
}

/** The microphone was refused: say so, show how to allow it, and hide the mic until the page is reloaded. */
function onBlocked(code) {
  blocked = true;
  if (A.listen) A.listen.blocked = true;
  resolveAnswer(null);
  const btn = document.getElementById("micBtn");
  if (btn) { btn.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  const svc = code === "service-not-allowed";
  toast(svc ? "Speech recognition is off" : "Microphone blocked", 4000);
  showBlocked(code);
  say(svc ? "Speech recognition is turned off on this phone. The details are on screen."
    : "The microphone is blocked. The steps to allow it are on screen.", "blocked");
  releaseVoice();
}
function showBlocked(code) {
  if (!ov || ov.hidden) openOverlay(mode === "help" ? "command" : mode);
  const svc = code === "service-not-allowed";
  setState("error", { title: svc ? "Speech recognition is off" : "The microphone is blocked", hint: blockedText(code), tone: "hard", close: "Got it" });
  ui.said.textContent = "";
  ui.choices.hidden = true;
  ui.question.hidden = true;
  syncBody();
  autoClose(20000);
}
function blockedText(code) {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  if (code === "service-not-allowed") {
    return ios ? "Voice commands need Dictation. Turn it on in Settings, General, Keyboard, then reload this page."
      : "Speech recognition is turned off in this browser. Voice commands stay off until you reload.";
  }
  if (ios) return "To use voice commands, open Settings, then Safari, then Microphone, and choose Allow. Then reload this page.";
  if (android) return "Tap the icon left of the web address, then Permissions, and allow the microphone. Then reload this page.";
  return "Click the icon left of the web address and allow the microphone. Then reload this page.";
}

/* ---------- narration while the microphone is open ----------
   Speech that starts while we listen would talk into the microphone, so it waits until our reply is on its way.
   With voice.hold() (proposed for voice.js) the speech queue simply pauses. Until then we stop the voice and keep
   what we can: the line that was starting, plus the landmark announcements still queued (they are rebuilt at replay
   time with the new distance, the chime and the "still ahead" check, so a passed landmark is skipped). */
const canHold = () => !!(A && A.voice && typeof A.voice.hold === "function");
/** ms until speech may start again: voice.js can still be inside the chime of an item we just stopped. */
const guardWait = () => (A && A.settings && A.settings.chime === false ? 0 : Math.max(0, heldAt + GUARD_MS - now()));
function keepHeld(it) {
  if (!it || (!it.text && !it.place)) return;
  if (it.id != null) held = held.filter(x => x.id !== it.id);
  held.push(it);
  if (held.length > 6) held.shift();
}
function takeHeld() { const k = held; held = []; return k; }
/** Stop the voice now; landmark announcements still waiting in its queue are kept for later. */
function stopVoice() {
  const V = A && A.voice;
  if (!V) return;
  let ids = [], cur = null, busy = false;
  try { ids = (V.queued && V.queued()) || []; } catch {}
  try { cur = V.currentId ? V.currentId() : null; busy = V.isSpeaking ? !!V.isSpeaking() : false; } catch {}
  for (const id of ids) {
    const p = id != null && id !== cur ? queuedAnn.get(id) : null;
    if (p) keepHeld({ id, place: p });
  }
  // voice.js plays an item's chime right after the item starts, so the risky window runs from that start
  // (our own lines never have a chime)
  if (busy && !isMine(cur)) heldAt = Math.max(heldAt, lastSpeech && lastSpeech.id === (cur == null ? "" : String(cur)) ? lastSpeech.t : now());
  try { V.stop && V.stop(); } catch (e) { warn(e); }
}
/** Before the microphone opens: silence the voice and keep the rest for after our reply. */
function quietVoice() {
  clear("release", "say"); // nothing of ours may start into the open microphone either
  if (canHold()) {
    try { A.voice.hold(true); holding = true; } catch (e) { warn(e); }
    let busy = false;
    try { busy = !!(A.voice.isSpeaking && A.voice.isSpeaking()); } catch {}
    if (holding && !busy) return; // the queue waits inside voice.js
  }
  stopVoice();
}
/**
 * Our reply is on its way: queue the held narration behind it (or drop it: "be quiet", narration off, a new trip).
 * Waits out the chime guard first, so a replayed line can't be cut short.
 */
function releaseVoice(drop = false) {
  clear("release");
  const wait = guardWait();
  if (wait > 0 && !drop) { later("release", wait, () => releaseVoice(false)); return; }
  const items = takeHeld();
  if (!drop) requeue(items);
  if (holding) { holding = false; try { A.voice.hold(false); } catch (e) { warn(e); } }
}
function requeue(items) {
  for (const it of items || []) {
    try {
      const p = it.place;
      if (!p) { if (it.text) A.voice.say(it.text, { id: it.id, prio: 1 }); continue; }
      if ((A.settings && A.settings.narr === false) || S().m == null || !(ahead(p.m) > -0.6)) continue; // off, or passed it
      const text = N() && N().announceText ? N().announceText(p, Math.max(0, ahead(p.m))) : it.text;
      if (text) A.voice.say(text, { id: p.id, prio: 1, chime: true, check: () => S().m != null && ahead(p.m) > -0.6 });
    } catch (e) { warn(e); }
  }
}

/* =========================================================================================
   Speaking and the reply caption
   ========================================================================================= */

function toast(text, ms) { try { A.ui && A.ui.toast && A.ui.toast(text, ms); } catch (e) { warn(e); } }
/**
 * Speak one of our own short lines (never counted as "the last thing said" for repeat). Ordinary priority, like the
 * narrator's answers: voice.js keeps prio >= 2 items (chain controls, severe weather) through a now:true and replays
 * them when interrupted, so an urgent reply would come back after the user's next question and stack up stale answers.
 */
function say(text, key) {
  const wait = guardWait();
  if (wait > 0) { later("say", wait, () => say(text, key)); return Promise.resolve(false); }
  // check(): an answer that a newer command has replaced is dropped instead of replayed (voice.hold keeps
  // whatever was speaking when the mic opened, and that may be our own previous answer)
  const seq = cmdSeq;
  try { if (A.voice && A.voice.say) return A.voice.say(text, { now: true, id: "listen:" + key, prio: 1, check: () => seq === cmdSeq }); } catch (e) { warn(e); }
  return Promise.resolve(false);
}
/** Speak an answer and caption it under the header. */
function reply(text, head, key = "reply") {
  showBanner(head, text, false);
  say(text, key);
}
function expect(head) { expectReply = { head, until: now() + 2500 }; }

function buildBanner() {
  const root = h("div", "lsn-reply");
  root.hidden = true;
  root.setAttribute("role", "status");
  const card = h("div", "lsn-reply-card");
  const eq = h("span", "lsn-eq");
  eq.setAttribute("aria-hidden", "true");
  eq.append(h("i"), h("i"), h("i"));
  const tx = h("div", "lsn-reply-tx");
  const q = h("small", "lsn-reply-q");
  const a = h("p", "lsn-reply-a");
  tx.append(q, a);
  const x = h("button", "lsn-reply-x");
  x.type = "button";
  x.setAttribute("aria-label", "Stop and close");
  x.append(svg(ICON.x));
  x.addEventListener("click", () => {
    if (banner.speaking) { try { A.voice.stop(); } catch {} }
    hideBanner();
  });
  card.append(eq, tx, x);
  root.append(card);
  document.body.append(root);
  banner = { root, q, a, text: "", speaking: false, shownAt: 0, minMs: 0 };
}
function showBanner(head, text, speaking) {
  if (!banner) buildBanner();
  const b = banner;
  b.text = String(text || "");
  b.q.textContent = head || "";
  b.q.hidden = !head;
  b.a.textContent = b.text;
  b.a.scrollTop = 0;
  b.shownAt = now();
  b.minMs = Math.max(3000, Math.min(12000, 1800 + b.text.length * 45));
  b.speaking = !!speaking;
  if (speaking) b.root.dataset.speaking = "1"; else delete b.root.dataset.speaking;
  try {
    const top = document.querySelector("header.top");
    const y = top ? Math.max(0, top.getBoundingClientRect().bottom) : 0;
    b.root.style.top = Math.round(y + 6) + "px";
  } catch {}
  b.root.hidden = false;
  clear("banner");
  if (!speaking) hideBannerLater(0);
}
function hideBannerLater(ms) {
  if (!banner || banner.root.hidden || (A.listen && A.listen.debug && A.listen.debug.hold)) return;
  later("banner", Math.max(ms, banner.minMs - (now() - banner.shownAt)), hideBanner);
}
function hideBanner() {
  clear("banner");
  if (!banner) return;
  banner.root.hidden = true;
  banner.speaking = false;
  delete banner.root.dataset.speaking;
}

function onSpeaking(s) {
  if (!s) {
    if (banner && banner.speaking) { banner.speaking = false; delete banner.root.dataset.speaking; hideBannerLater(1400); }
    return;
  }
  const mine = isMine(s.id);
  lastSpeech = { id: typeof s.id === "string" ? s.id : "", t: now() };
  if (s.id != null) queuedAnn.delete(s.id);
  // Narration that starts while the mic is open would talk into the microphone: hold it for later.
  if (sess && !mine) {
    const p = placeFromSpeechId(s.id);
    keepHeld({ id: s.id, text: s.text, place: p && p.id === s.id ? p : null }); // a landmark announcement is rebuilt later
    lastSpokeMine = true; // voice.js now remembers the held line as "last": repeat from our own record instead
    stopVoice();
    return;
  }
  if (!mine) {
    lastContent = { id: s.id, text: s.text };
    lastSpokeMine = false;
    const p = placeFromSpeechId(s.id);
    if (p) lastPlace = { p, t: now() };
  } else lastSpokeMine = true;
  if (expectReply && now() < expectReply.until && !mine) {
    const head = expectReply.head;
    expectReply = null;
    showBanner(head, s.text, true);
    return;
  }
  if (banner && !banner.root.hidden) {
    if (s.text === banner.text) { banner.speaking = true; banner.root.dataset.speaking = "1"; clear("banner"); }
    else if (!mine) hideBanner(); // ordinary narration takes over; the Drive card shows it
  }
}

/* =========================================================================================
   Commands
   ========================================================================================= */

const SVC_LABEL = { fuel: "Next gas", ev: "Next EV charger", food: "Next food", sleep: "Next place to sleep", rest: "Next rest area" };
const STATE_LABEL = { CA: "California", OR: "Oregon", WA: "Washington", next: "the state line" };
const stLabel = code => (code === "N" || code === "S" ? ends()[code].short : STATE_LABEL[code] || "the state line");
function label(c) {
  const a = c.arg;
  switch (c.cmd) {
    case "look": return a === "left" ? "What's on my left" : "What's on my right";
    case "more": return a ? `About ${a}` : "Tell me more";
    case "repeat": return "Say that again";
    case "next": return "Next landmark";
    case "quiet": return "Quiet";
    case "where": return "Where are we";
    case "howfar": return c.past ? `How far to ${shortDest(c.past)}` : c.st ? `How far to ${stLabel(c.st)}` : a ? `How far to ${shortDest(a)}` : c.eta ? "When we get there" : "How far";
    case "distance": return `How far to ${a}`;
    case "services": return SVC_LABEL[a] || "Services";
    case "weather": return "Weather";
    case "road": return "Road conditions";
    case "trivia": return a === "next" ? "Next question" : a === "read" ? "Read the question" : "Trivia";
    case "answer": return `Answer ${LETTERS[a] || ""}`.trim();
    case "sign": return "Freeway signs";
    case "rate": return a === "slower" ? "Speak slower" : "Speak faster";
    case "narr": return a === false ? "Narration off" : a === true ? "Narration on" : "Narration";
    case "kid": return a === false ? "Kid mode off" : "Kid mode on";
    case "chat": return { low: "Only the big stuff", normal: "Normal chatter", high: "Story time" }[a] || "Chattiness";
    case "theme": return { dark: "Night colors", light: "Day colors", auto: "Day/night colors" }[a] || "Colors";
    case "volume": return "Volume";
    case "speed": return "Our speed";
    case "elevation": return "Elevation";
    case "exit": return "Next exit";
    case "stamps": return "Passport stamps";
    case "tab": return c.game === "bingo" ? "Road bingo" : c.game === "spy" ? "I spy" : { map: "Map", passport: "Passport", play: "Play", drive: "Drive", ahead: "Ahead" }[a] || "Open";
    case "settings": return "Settings";
    case "start": return a === "demo" ? "Demo drive" : "Start GPS";
    case "end": return "End trip";
    case "joke": return "A joke";
    case "story": return "A story";
    case "around": return "What's that";
    case "land": return a === "farm" ? "What's growing here" : "What's out there";
    case "announce": return "Play";
    case "help": return "What can I say";
    case "thanks": return "Thanks";
    case "hello": return "Hello";
    default: return "";
  }
}

/** The app's toast is a narrow pill: keep what goes in it to about one line. */
function shortLabel(s) {
  s = String(s || "");
  return s.length <= 26 ? s : s.slice(0, 25).replace(/\s+\S*$/, "") + "…";
}

/**
 * Run a command from a chip tap: unlock speech inside the tap (iOS), close the panel, run the command, and only then
 * queue the narration that waited for the microphone (our reply interrupts whatever is queued before it).
 */
function tapRun(c) {
  try { A.voice && A.voice.unlock && A.voice.unlock(); } catch {}
  if (c.cmd === "help") { openHelp(false); return; }
  closeOverlay(true);
  const wait = guardWait();
  if (wait > 0) later("run", wait, () => runThenRelease(c, {}));
  else runThenRelease(c, {});
}

/** Run a command. Returns "later" when its spoken answer comes later (live data); it releases held narration itself. */
function run(c, meta = {}) {
  cmdSeq++;
  asyncReply = false;
  try { runInner(c, meta); } catch (e) { warn(e); asyncReply = false; reply("Sorry, that didn't work.", label(c), "fail"); }
  return asyncReply ? "later" : "";
}
function runInner(c, meta) {
  const lbl = label(c);
  const head = meta.heard ? `“${meta.heard}”` : lbl;
  const st = S(), set = A.settings || {};
  const nar = (fn, ...args) => { const n = N(); if (n && typeof n[fn] === "function") { expect(head); n[fn](...args); return true; } return false; };
  const noPos = "Start GPS or a demo drive first, then I can tell you.";
  const unavailable = () => reply("That isn't available right now.", head, "na");
  if (lbl && !["cancel", "help", "unknown", "rate"].includes(c.cmd)) toast(shortLabel(lbl));

  switch (c.cmd) {
    case "look": if (!nar("look", c.arg === "left" ? "left" : "right")) unavailable(); break;
    case "more": {
      const p = c.arg ? resolvePlace(c.arg, c.cands) : currentPlace();
      if (!p) { reply("I'm not sure which place you mean. Start a drive, or pick one on the Ahead tab.", head); break; }
      if (!nar("tellMore", p)) unavailable();
      break;
    }
    case "repeat": {
      if (lastContent && lastContent.text) {
        expect(head);
        if (!lastSpokeMine && A.voice && typeof A.voice.repeat === "function") A.voice.repeat();
        else A.voice.say(lastContent.text, { now: true, id: lastContent.id });
        break;
      }
      const card = currentPlace();
      if (card && st.m != null && N() && N().announceText) {
        expect(head);
        A.voice.say(N().announceText(card, Math.max(0, ahead(card.m))), { now: true, id: card.id });
      } else reply("I haven't said anything yet.", head);
      break;
    }
    case "next": {
      if (st.m == null) { reply(noPos, head); break; }
      let list = [];
      try { list = N() && N().upcoming ? N().upcoming() || [] : []; } catch {}
      if (!list.length) { reply("That's every landmark in this direction for the places you picked.", head); break; }
      if (!nar("nextOne")) unavailable();
      break;
    }
    case "quiet": try { A.voice.stop(); } catch {} hideBanner(); break;
    case "where": if (!nar("whereAreWe")) unavailable(); break;
    case "howfar": {
      if (c.past) { reply(pastText(c.past), head); break; } // past the road the app covers: the destination stays
      if (c.st) { reply(stateLineText(c.st, c), head); break; }
      let dest = null;
      if (c.arg) dest = (Array.isArray(D().DESTS) ? D().DESTS : []).find(x => x && normText(x.name) === normText(c.arg)) || null;
      else if (c.q) {
        const ex = exampleDest();
        reply(`I don't know where ${c.q} is on I-5.${ex ? ` Try a city, like ${shortDest(ex.name)}.` : ""}`, head);
        break;
      }
      if (dest) {
        // "Where is Redding" only asks; and a city behind us is not where we're going. Keep the trip's destination.
        const back = st.m != null ? -ahead(dest.m) : 0;
        if (back > 1) { reply(`${cap(shortDest(dest.name))} is about ${Math.round(back)} miles behind us.`, head); break; }
        if (c.ask) { if (!nar("howFar", { name: dest.name, m: dest.m })) unavailable(); break; }
        st.dest = { name: dest.name, m: dest.m };
        try { A.store && A.store.set("dest", st.dest); } catch {}
        try { A.bus && A.bus.emit("dest", st.dest); } catch {}
        try { A.ui && A.ui.queueRender && A.ui.queueRender(); } catch {}
      }
      const eta = c.eta ? etaText(dest || st.dest) : "";
      if (eta) { reply(eta, head); break; }
      if (!nar("howFar")) unavailable();
      break;
    }
    case "land": {
      if (st.m == null) { reply("Start GPS or a demo drive first, then I can tell you what's out there.", head); break; }
      if (c.arg === "farm") {
        // a farm landmark right here says it best ("Walnut orchards"); else the landscape of this stretch
        const f = places().filter(p => p && p.cat === "farm" && isFinite(p.m)).map(p => ({ p, d: ahead(p.m) }))
          .filter(x => x.d > -2 && x.d < 4).sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
        if (f && nar("hear", f.p)) break;
      }
      const t = landText();
      if (t) reply(t, head, "land");
      else aroundHere(head, nar, unavailable);
      break;
    }
    case "distance": {
      const p = resolvePlace(c.arg, c.cands);
      reply(p ? distanceText(p) : `I don't know where ${c.arg} is.`, head);
      break;
    }
    case "services": if (!nar("tellServices", c.arg || "fuel")) unavailable(); break;
    case "weather": liveLine(["weatherText"], head, "weather"); break;
    case "road": liveLine(["roadText", "alertsText", "weatherText"], head, "road conditions"); break;
    case "trivia": {
      const P = A.play || {};
      if (typeof P.askTrivia !== "function") { reply("Trivia isn't available right now.", head); break; }
      if (c.arg === "read" && typeof P.readTrivia === "function") { try { P.open && P.open("trivia"); } catch {} P.readTrivia(); break; }
      if (c.arg === "next" && typeof P.nextTrivia === "function") {
        try { P.open && P.open("trivia"); } catch {}
        const t0 = now();
        P.nextTrivia();
        later("trivia", 200, () => { if (!(lastSpeech && lastSpeech.t >= t0 && /^play:/.test(lastSpeech.id))) P.readTrivia && P.readTrivia(); });
        break;
      }
      P.askTrivia();
      break;
    }
    case "answer": {
      const P = A.play || {};
      const none = "There's no trivia question waiting. Say: ask me trivia.";
      if (typeof P.answerTrivia !== "function") { reply(none, head); break; }
      // Trivia speaks the verdict: caption it, and show the trivia card (it shows the verdict) if we're elsewhere.
      // Answer first, then open: opening Play can swap an unanswered question that has gone stale.
      const asked = () => { try { const s = P.score && P.score(); return s && s.trivia ? Number(s.trivia.asked) : NaN; } catch { return NaN; } };
      const showIt = () => { if (!viewShown("view-play")) try { P.open && P.open("trivia"); } catch (e) { warn(e); } };
      const before = asked(), t0 = now();
      expect(head);
      P.answerTrivia(c.arg);
      const after = asked();
      if (isFinite(before) && isFinite(after)) {
        if (after > before) showIt();
        else { expectReply = null; reply(none, head); }
        break;
      }
      // no score(): answerTrivia() returns false for a wrong answer too, but then it speaks; silence means nothing was waiting
      asyncReply = true;
      later("answer", 600, () => {
        if (lastSpeech && lastSpeech.t >= t0 && /^play:/.test(lastSpeech.id)) showIt();
        else { expectReply = null; reply(none, head); }
        releaseVoice();
      });
      break;
    }
    case "sign": liveLine(["signText"], head, "freeway signs"); break;
    case "rate": {
      const cur = Number(set.rate) || 1;
      const nxt = Math.round(Math.max(0.7, Math.min(1.4, cur + (c.arg === "slower" ? -0.1 : 0.1))) * 100) / 100;
      if (nxt === cur) {
        toast(lbl);
        reply(c.arg === "slower" ? "This is as slow as I go." : "This is as fast as I go.", head);
        break;
      }
      set.rate = nxt;
      try { A.saveSettings(); } catch {}
      toast(`${lbl} · ${nxt.toFixed(2).replace(/0$/, "")}×`);
      reply(c.arg === "slower" ? "Okay, I'll speak a little slower." : "Okay, I'll speak a little faster.", head);
      break;
    }
    case "narr": {
      const on = c.arg == null ? !set.narr : !!c.arg;
      set.narr = on;
      try { A.saveSettings(); } catch {}
      if (!on) try { A.voice.stop(); } catch {}
      try { A.ui.queueRender(); } catch {}
      reply(on ? "Narration on. I'll tell you about places as we go." : "Narration off. I'll stay quiet until you ask me something.", head);
      break;
    }
    case "kid": {
      const on = c.arg == null ? !set.kid : !!c.arg;
      set.kid = on;
      try { A.saveSettings(); } catch {}
      reply(on ? "Kid mode on. I'll add I-spy challenges to the landmarks." : "Kid mode off.", head);
      break;
    }
    case "chat": {
      set.chat = c.arg;
      try { A.saveSettings(); } catch {}
      reply({ low: "Okay, I'll stick to the big stuff.", normal: "Okay, back to normal.", high: "Story time is on. I'll tell longer stories on the quiet stretches." }[c.arg] || "Okay.", head);
      break;
    }
    case "theme": {
      const b = document.querySelector(`[data-theme-set="${c.arg}"]`);
      if (b) b.click();
      else {
        set.theme = c.arg;
        try { A.saveSettings(); } catch {}
        if (c.arg !== "auto") document.documentElement.dataset.theme = c.arg;
      }
      break;
    }
    case "volume": reply("I can't change how loud I am. Use the volume buttons on your phone.", head); break;
    case "speed":
      reply(st.speed != null && (st.mode === "gps" || st.mode === "demo") ? `We're doing about ${Math.round(st.speed)} miles an hour.`
        : "I don't know our speed right now. Start GPS and I'll keep track.", head);
      break;
    case "elevation": reply(elevationText(), head); break;
    case "exit": reply(nextExitText(), head); break;
    case "stamps": {
      const got = Object.keys(st.stamps || {}).length, total = places().length;
      reply(got ? `You've collected ${got} of ${total} stamps.${got >= total && total ? " That's every one of them." : ""}`
        : "No stamps yet. You get one for every landmark we drive past.", head);
      break;
    }
    case "tab":
      try {
        if (c.arg === "play" && A.play && typeof A.play.open === "function") A.play.open(c.game);
        else A.ui.go(c.arg);
      } catch (e) { warn(e); }
      break;
    case "settings": { const b = document.getElementById("openSettings"); if (b) b.click(); break; }
    case "start":
      if (c.arg === "demo") { if (A.startDemo) A.startDemo(); else unavailable(); }
      else if (st.mode === "gps") reply("GPS is already on.", head);
      else if (A.startGps) A.startGps(); else unavailable();
      break;
    case "end":
      if (st.mode === "off" || !st.mode) reply("There's no trip running right now.", head);
      else if (A.stopAll) A.stopAll(false); else unavailable();
      break;
    case "joke": reply(JOKES[jokeIdx++ % JOKES.length], head, "joke"); break;
    case "story": {
      const p = storyPlace();
      if (!p) { reply(st.m == null ? "Start GPS or a demo drive and I'll tell you about the places we pass." : "I don't have a story for this stretch of road yet.", head); break; }
      told.add(p.id);
      if (!nar(p.more ? "tellMore" : "hear", p)) unavailable();
      break;
    }
    case "around": aroundHere(head, nar, unavailable); break;
    case "announce": {
      const p = currentPlace();
      if (!p || st.m == null || !N() || !N().announceText) { reply(noPos, head); break; }
      expect(head);
      try { N().markHeard && N().markHeard(p.id); } catch {}
      A.voice.say(N().announceText(p, Math.max(0, ahead(p.m))), { now: true, id: p.id, chime: true });
      break;
    }
    case "help": openHelp(true); break;
    case "thanks": reply("You're welcome.", head); break;
    case "hello": reply("Hi. Ask me what's on your left, or say help to hear more.", head); break;
    case "cancel": break;
    default: reply("Sorry, I didn't catch that. Try: what's on my left.", head, "unknown");
  }
}

/** Ask the live module (it may answer now or later, or not at all). */
function liveLine(fns, head, what) {
  const live = A.live;
  const fn = live && fns.map(f => live[f]).find(f => typeof f === "function");
  const off = !(A.settings && A.settings.live);
  const turnOn = `Turn on live road info in Settings for ${what}.`;
  if (!fn) {
    reply(off ? turnOn : "Live road info isn't ready yet. Try again in a minute.", head);
    return;
  }
  let res;
  try { res = fn.call(live); } catch (e) { warn(e); res = null; }
  const done = text => {
    const t = typeof text === "string" ? text.trim() : "";
    if (t) reply(t, head, "live");
    else reply(off ? turnOn : `I don't have ${what === "weather" ? "a forecast" : "road reports"} for this stretch yet. Try again in a minute.`, head);
  };
  if (res && typeof res.then === "function") {
    // The answer comes later: narration that waited for the microphone is queued after it (see run()).
    asyncReply = true;
    const seq = cmdSeq;
    let settled = false;
    const t = setTimeout(() => settle(""), 8000);
    function settle(v) {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      if (sess) return;                  // listening again: that session speaks next and releases
      if (seq === cmdSeq) done(v);       // else the user moved on to another command: drop the late answer
      releaseVoice();
    }
    res.then(v => settle(v), () => settle(""));
  } else done(res);
}

/** "What's that": the nearest landmark, things you can see first, told from the side it's on. */
function aroundHere(head, nar, unavailable) {
  if (S().m == null) { if (!nar("look", "right")) unavailable(); return; }
  const cand = places().filter(p => p && isFinite(p.m)).map(p => ({ p, d: ahead(p.m) })).filter(x => x.d > -2 && x.d < 5)
    .sort((a, b) => (Math.abs(a.d) - (a.p.vis ? 1.5 : 0)) - (Math.abs(b.d) - (b.p.vis ? 1.5 : 0)))[0];
  if (!cand) { if (!nar("whereAreWe")) unavailable(); return; }
  const side = sideOf(cand.p);
  if (side) { if (!nar("look", side)) unavailable(); }
  else if (!nar("hear", cand.p)) unavailable();
}
/** The landscape of this stretch, from the zone data (with this season's note). */
function landText() {
  let z = null, season = "";
  try { z = D().zoneAt ? D().zoneAt(S().m) : null; } catch {}
  if (!z || !z.text) return "";
  try { const k = D().seasonOf ? D().seasonOf() : null; season = (k && z.seasons && z.seasons[k]) || ""; } catch {}
  return `Out here: ${z.label}. ${z.text}${season ? " " + season : ""}`;
}
const cap = s => String(s || "").replace(/^\w/, ch => ch.toUpperCase());
const viewShown = id => { const v = document.getElementById(id); return !!v && !v.hidden; };
/** Miles an hour to plan with: our speed when we're moving, else a typical I-5 pace. */
const pace = () => { const v = S().speed; return v && v > 25 ? v : 62; };
/** " Without stops, we'd get there about 9:40 PM." for a drive of hrs hours ("" when that's too far off to say). */
function clockLine(hrs) {
  if (!isFinite(hrs) || hrs <= 0) return "";
  const at = new Date(now() + hrs * 3600e3);
  let clock = "";
  try { if (hrs < 20) clock = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch {}
  const day = at.toDateString() === new Date(now()).toDateString() ? "" : at.getDate() === new Date(now() + 864e5).getDate() ? " tomorrow" : "";
  return clock ? ` Without stops, we'd get there about ${clock}${day}.` : "";
}
/** "Redding is about 368 miles away, around 5 h 56 min of driving. Without stops, we'd get there about 9:40 PM." */
function etaText(dest) {
  const st = S();
  if (!dest || st.m == null || !isFinite(dest.m)) return "";
  const a = ahead(dest.m);
  if (a < 1) return ""; // there already, or behind: the narrator says so
  const hrs = a / pace(), t = dur(hrs);
  return `${cap(shortDest(dest.name))} is about ${Math.round(a)} miles away${t ? `, around ${t} of driving` : ""}.${clockLine(hrs)}`;
}

/* ---------- the ends of the road the app covers (data.STATES, data.MAX_M, data.ENDS; any of them may be missing) ---------- */
// I-5 from south to north. The app covers a run of these (data.STATES); data.ENDS names what lies past each end.
const ROAD_ORDER = ["MX", "CA", "OR", "WA", "BC"];
// What lies past an end of the road when data.ENDS doesn't say (tools/build.py uses the same names).
const PAST_END = { MX: ["Mexico", "the Mexico border"], CA: ["California", "the California line"], OR: ["Oregon", "the Oregon line"],
  WA: ["Washington", "the Washington line"], BC: ["Canada", "the Canadian border"] };
function statesList() {
  return Array.isArray(D().STATES) ? D().STATES.filter(s => s && s.id && isFinite(s.from) && isFinite(s.to)) : [];
}
/** [first, last]: where the states the app covers sit in ROAD_ORDER, or null when the data has none. */
function coveredSpan() {
  const k = statesList().map(s => ROAD_ORDER.indexOf(s.id)).filter(i => i >= 0);
  return k.length ? [Math.min(...k), Math.max(...k)] : null;
}
/** What lies past each end: {S: {short: "Mexico", long: "the Mexico border"}, N: {short: "Oregon", long: "the Oregon line"}}. */
function ends() {
  const E = D().ENDS || {}, span = coveredSpan();
  const ok = x => !!x && typeof x.short === "string" && !!x.short && typeof x.long === "string" && !!x.long;
  const guess = (code, dflt) => { const n = PAST_END[code] || PAST_END[dflt]; return { short: n[0], long: n[1] }; };
  return { S: ok(E.S) ? E.S : guess(span && ROAD_ORDER[span[0] - 1], "MX"), N: ok(E.N) ? E.N : guess(span && ROAD_ORDER[span[1] + 1], "BC") };
}
/** The corridor mile of an end of the covered road: "S" (mile 0, the Mexico border) or "N" (data.MAX_M); null if unknown. */
function endMile(end) {
  const list = statesList();
  if (end === "S") return list.length ? Math.min(...list.map(s => s.from)) : 0;
  const top = Number(D().MAX_M);
  if (isFinite(top) && top > 0) return top;
  return list.length ? Math.max(...list.map(s => s.to)) : null;
}
/** Does that end of the road stop at a state line (the Oregon line), rather than at a country's border? */
const endIsStateLine = end => !!STATE_IDS[normText(ends()[end].short)];
/** Which end of the covered road a state or country lies past: "N", "S", or null (covered, or unknown). */
function pastWhichEnd(code) {
  const span = coveredSpan(), k = ROAD_ORDER.indexOf(code);
  if (!span || k < 0) return null;
  return k > span[1] ? "N" : k < span[0] ? "S" : null;
}
/** Off the road past one of its ends, the way main.js tells it (GPS beyond the last point of the road): "N", "S" or null. */
function pastEndNow() {
  const st = S(), R = Array.isArray(D().ROUTE) ? D().ROUTE : [];
  const first = R[0], last = R[R.length - 1];
  if (!st.offRoute || st.lat == null || st.m == null || !Array.isArray(first) || !Array.isArray(last)) return null;
  const top = endMile("N");
  if (top != null && st.lat > last[1] && st.m > top - 3) return "N";
  if (st.lat < first[1] && st.m < endMile("S") + 3) return "S";
  return null;
}
/** "I-5 Buddy covers I-5 in California" (or "" when the data doesn't say). */
function coverWords() {
  const names = statesList().map(s => s.name).filter(Boolean);
  return names.length ? `I-5 Buddy covers I-5 in ${listJoin(names)}` : "";
}
/**
 * How far to an end of the road the app covers: "N" (data.MAX_M, data.ENDS.N: the Oregon line when it covers
 * California) or "S" (the Mexico border). o.next = they asked for the next state line; o.eta = they want a clock time.
 */
function endText(end, o = {}) {
  end = end === "S" ? "S" : "N";
  const st = S(), name = ends()[end].long, at = endMile(end), tail = "the end of the road for I-5 Buddy";
  const lead = o.next && !endIsStateLine(end) ? "There are no more state lines this way. " : "";
  if (at == null) return `${lead}${cap(name)} is ${tail}.`;
  if (st.m == null) return `${lead}${cap(name)} is at mile ${Math.round(at)}, ${tail}. Start GPS or a demo drive and I'll count down to it.`;
  if (pastEndNow() === end) return `We're past ${name}, ${tail}.`;
  const d = Math.abs(at - st.m);
  if (d < 1) return `We're at ${name}, ${tail}.`;
  if ((end === "N") !== (st.dir !== "S")) return `${lead}${cap(name)} is behind us, about ${Math.round(d)} miles back.`;
  const hrs = d / pace(), t = dur(hrs);
  return `${lead}${cap(name)} is about ${Math.round(d)} miles ahead${t ? `, around ${t}` : ""}. That's ${tail}.${o.eta ? clockLine(hrs) : ""}`;
}
/**
 * A place past the road the app covers: "Portland is past the Oregon line. I-5 Buddy covers I-5 in California, and the
 * Oregon line is about 120 miles away." code: where it is (a state id, "BC" or "MX"); WHOLE_ROAD knows the rest.
 */
function pastText(name, code) {
  const end = pastWhichEnd(code || WHERE.get(normText(name)));
  const it = cap(shortDest(name));
  if (!end) { // on the road the app covers after all, just not one of its destinations (a smaller town)
    const ex = exampleDest();
    return `I don't know exactly where ${it} is on I-5.${ex ? ` Try a city, like ${shortDest(ex.name)}.` : ""}`;
  }
  const st = S(), E = ends(), line = E[end].long, at = endMile(end), cover = coverWords();
  const lead = `${it} is past ${line}.`;
  if (!cover) return lead;
  if (at == null || st.m == null) return `${lead} ${cover}, from ${E.S.long} to ${E.N.long}.`;
  if (pastEndNow() === end) return `${lead} ${cover}, and we're already past ${line}.`;
  const d = Math.abs(at - st.m);
  if (d < 1) return `${lead} ${cover}, and we're at ${line} now.`;
  const behind = (end === "N") !== (st.dir !== "S");
  return `${lead} ${cover}, and ${line} is about ${Math.round(d)} miles ${behind ? "behind us" : "away"}.`;
}
/**
 * How far to a state line: a state id ("OR"), "next" (the next one ahead), or an end of the road ("N" | "S").
 * A state the app doesn't cover is the end of the road (Oregon, on the California road) or lies past it (Washington).
 */
function stateLineText(code, o = {}) {
  if (code === "N" || code === "S") return endText(code, o);
  const st = S(), list = statesList(), north = st.dir !== "S";
  if (code !== "next" && !list.some(s => s.id === code)) {
    const end = pastWhichEnd(code);
    if (end && STATE_IDS[normText(ends()[end].short)] === code) return endText(end, o);
    if (end) return pastText(STATE_LABEL[code] || code, code);
    return list.length ? "I don't know that state." : "I don't know where the state lines are.";
  }
  if (!list.length) return "I don't know where the state lines are.";
  if (st.m == null) return "Start GPS or a demo drive first, then I can count down to the state line.";
  const i = list.findIndex(s => st.m >= s.from && st.m < s.to);
  const here = list[i >= 0 ? i : list.length - 1];
  const s = code === "next" ? list[(i >= 0 ? i : list.length - 1) + (north ? 1 : -1)] : list.find(x => x.id === code);
  if (code === "next" && !s) return endText(north ? "N" : "S", Object.assign({}, o, { next: true }));
  if (s === here) return `We're in ${s.name} now.`;
  const line = north ? s.from : s.to; // where we'd cross into it
  const d = north ? line - st.m : st.m - line;
  if (d < 0) return `${s.name} is behind us, about ${Math.max(1, Math.round(Math.abs(north ? st.m - s.to : s.from - st.m)))} miles back.`;
  const hrs = d / pace(), t = dur(hrs);
  return `${code === "next" ? `The next state line is ${s.name}, about` : `The ${s.name} state line is about`} ${Math.max(1, Math.round(d))} miles ahead.${t ? ` That's around ${t}.` : ""}${o.eta ? clockLine(hrs) : ""}`;
}

function distanceText(p) {
  const st = S();
  if (st.m == null) return `${p.name} is near ${exitName(p.st, p.ex)}. Start GPS or a demo drive and I'll count down to it.`;
  const d = ahead(p.m), a = Math.abs(d), side = sideOf(p);
  if (a < 0.5) return `${p.name} is right here${side ? `, on your ${side}` : ""}.`;
  const mi = a < 1.5 ? "about a mile" : `about ${Math.round(a)} miles`;
  if (d < 0) return `${p.name} is ${mi} behind us.`;
  const mph = st.speed && st.speed > 25 ? st.speed : 62;
  const t = dur(a / mph);
  return `${p.name} is ${mi} ahead${side ? `, on the ${side}` : ""}.${t ? ` That's around ${t}.` : ""}`;
}
function elevationText() {
  const st = S();
  if (st.m == null) return "Start GPS or a demo drive first, then I can tell you how high we are.";
  let ft = null;
  try { ft = D().elevAt ? D().elevAt(st.m) : null; } catch {}
  if (ft == null) return "I don't have elevation for this stretch.";
  let s = `We're at about ${fmtNum(ft)} feet above sea level.`;
  try {
    const sum = D().summitAhead ? D().summitAhead(st.m, st.dir, 40) : null;
    if (sum) s += ` The road climbs to about ${fmtNum(sum.ft)} feet in the next ${Math.max(1, Math.round(Math.abs(sum.m - st.m)))} miles.`;
  } catch {}
  return s;
}
function nextExitText() {
  const st = S();
  if (st.m == null) return "Start GPS or a demo drive first, then I can find the next exit.";
  const ex = Array.isArray(D().EXITS) ? D().EXITS : [];
  const list = st.dir === "S" ? [...ex].reverse() : ex;
  const e = list.find(x => ahead(x[0]) >= 0.2);
  if (!e) return "There are no more exits in this direction.";
  const d = ahead(e[0]);
  const signs = [...new Set(String(e[3] || "").split(/[;,]/).map(s => s.trim()).filter(Boolean))].slice(0, 3);
  const svc = (Array.isArray(D().SERVICES) ? D().SERVICES : []).find(s => s.st === e[1] && s.ref === e[2]);
  const hasSvc = svc ? [["fuelN", "gas"], ["foodN", "food"], ["sleepN", "lodging"], ["evN", "EV charging"]].filter(([k]) => svc[k] > 0).map(([, w]) => w) : [];
  const dist = d < 1 ? "in less than a mile" : `in about ${Math.round(d)} mile${Math.round(d) === 1 ? "" : "s"}`;
  return `Next exit: ${exitName(e[1], e[2])}, ${dist}.${signs.length ? ` Signs say ${listJoin(signs)}.` : ""}${hasSvc.length ? ` It has ${listJoin(hasSvc)}.` : ""}`;
}
/** A place to tell a story about: the nearest one with a long story, else the nearest one we haven't told yet. */
function storyPlace() {
  const st = S();
  const fresh = places().filter(p => p && p.id && !told.has(p.id));
  if (!fresh.length) return null;
  if (st.m == null) { const rich = fresh.filter(p => p.more); const l = rich.length ? rich : fresh; return l[Math.floor(Math.random() * l.length)]; }
  const pick = list => {
    const near = list.map(p => ({ p, d: ahead(p.m) }));
    const fwd = near.filter(x => x.d > -1 && x.d < 40).sort((a, b) => a.d - b.d)[0];
    if (fwd) return fwd.p;
    const back = near.filter(x => x.d <= -1 && x.d > -30).sort((a, b) => b.d - a.d)[0];
    return back ? back.p : null;
  };
  return pick(fresh.filter(p => p.more)) || pick(fresh);
}
const JOKES = [
  "Why don't mountains ever get cold? They wear snow caps.",
  "What do you call a sleeping cow? A bulldozer.",
  "Why are rivers always rich? They have two banks.",
  "What has four wheels and flies? A garbage truck.",
  "Why did the scarecrow win an award? He was outstanding in his field. We pass a lot of fields on I-5.",
  "What do you call a nut that sneezes? A cashew. Don't tell the almond orchards.",
  "Why did the cow cross the road? To get to the udder side.",
  "What did the big flower say to the little flower? Hi, bud.",
  "Why can't a bicycle stand up by itself? It's two tired.",
  "What kind of car does an egg drive? A yolks wagon.",
  "Why do cows wear bells? Because their horns don't work.",
  "What's a tree's favorite drink? Root beer.",
];

/* =========================================================================================
   init
   ========================================================================================= */

export function init(api) {
  A = api;
  destNamesMemo = placeNamesMemo = null; // started again with another api (the tests do): its data may differ
  const btn = document.getElementById("micBtn");
  const base = { parseCommand, parseAnswer, chooseCommand };
  try {
    if (!getSR()) {
      api.listen = Object.assign({ supported: false }, base);
      if (btn) btn.hidden = true;
      return;
    }
    api.listen = Object.assign({
      supported: true,
      blocked: false,
      /** Open the listening panel and start listening (call from a tap). */
      start,
      /** Trivia: resolves with the index of the spoken choice, or null. */
      listenForAnswer,
      /** Open the list of things you can say. */
      help: () => openHelp(false),
      /** Run a typed or spoken phrase as if it was heard. */
      run: text => { const c = chooseCommand([String(text || "")], destNames(), parseOpts()); if (c.cmd !== "unknown") run(c, { heard: String(text || "") }); return c; },
      /** Close the panel and stop listening. */
      stop: () => closeOverlay(),
      isListening: () => !!sess,
      /** For tests: hold = keep panels and captions open instead of closing them on a timer. */
      debug: {
        hold: false,
        reply: (head, text) => showBanner(head, text, true),
        state: () => ({ open: !!ov && !ov.hidden, state: ov && ov.dataset.state, mode, listening: !!sess, blocked }),
        runCmd: c => run(c, {}),
      },
    }, base);
    if (btn) {
      btn.hidden = false;
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", () => {
        try {
          if (ov && !ov.hidden && sess) stopRec(sess);
          else if (ov && !ov.hidden && mode === "help") listenNow("command");
          else start();
        } catch (e) { warn(e); }
      });
    }
    const bus = api.bus;
    if (bus && bus.on) {
      bus.on("speaking", s => { try { onSpeaking(s); } catch (e) { warn(e); } });
      // The narrator emits place:announce when it queues an announcement, not when it speaks it. So it is only a
      // fallback for "tell me more"; lastPlace comes from speech that actually started (onSpeaking) and place:look.
      bus.on("place:announce", x => {
        try {
          if (!x || !x.place) return;
          lastAnnounced = x.place;
          if (x.place.id != null) {
            queuedAnn.set(x.place.id, x.place);
            if (queuedAnn.size > 40) queuedAnn.delete(queuedAnn.keys().next().value);
          }
        } catch {}
      });
      bus.on("place:look", x => { try { if (x && x.place) lastPlace = { p: x.place, t: now() }; } catch {} });
      bus.on("trip:end", () => { lastPlace = null; lastAnnounced = null; queuedAnn.clear(); });
      bus.on("mode", md => { if (md === "off") queuedAnn.clear(); });
    }
    document.addEventListener("visibilitychange", () => {
      try { if (document.visibilityState === "hidden" && ov && !ov.hidden) closeOverlay(); } catch (e) { warn(e); }
    });
  } catch (e) {
    warn(e);
    try { if (!api.listen) api.listen = Object.assign({ supported: false }, base); } catch {}
  }
}
