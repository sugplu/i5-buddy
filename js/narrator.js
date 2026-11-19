// What to say, and when. Listens to position updates and speaks through voice.js.
import { S, settings, bus, saveStamps } from "./store.js";
import {
  PLACES, CATS, MAX_M, STATES, ENDS, SCOPE, zoneAt, seasonOf, stateAt, sideWord, aheadOf, summitAhead, elevAt, regionAt,
  servicesAhead, restAhead, exitName, fmtDuration, localMile, placeById, detourSentence,
} from "./data.js";
import { miles } from "./geo.js";
import { voice } from "./voice.js";

// Announced places are remembered per direction (3.0.1): "id|N", "id|S". Before, a place heard northbound stayed
// "heard" after turning around, so the whole drive back was silent unless End trip was tapped in between.
const heard = new Set();      // place id + direction, announced this trip
const told = new Set();       // place ids whose "more" story was told this trip
const toldZones = new Set();  // landscape zones described this trip, per direction (3.0.4: GPS wobbling on a zone
                              // line used to describe the same stretch again each time it crossed back)
let lastZone = null, lastState = null, lastSummit = null, halfwayDone = false;
let lastSpokeAtM = null;      // corridor mile of the last landmark announcement (for story time)
let lastSpokeAt = 0;          // and its time
const hk = (id, dir = S.dir) => id + "|" + dir;
const STORY_MI = 5, STORY_MS = 4 * 60e3; // story time after this much quiet road, or this long without a landmark

export function resetTrip() {
  heard.clear(); told.clear(); toldZones.clear();
  lastZone = null; lastState = null; lastSummit = null; halfwayDone = false; lastSpokeAtM = null; lastSpokeAt = 0;
}

/** Places the user wants to hear about, in travel order, with signed distance d (positive = ahead). */
export function upcoming(m = S.m, dir = S.dir, cats = settings.cats, range = 1e9) {
  if (m == null) return [];
  const list = [];
  for (const p of PLACES) {
    if (cats && !cats.has(p.cat)) continue;
    const d = aheadOf(m, dir, p.m);
    if (d > -0.5 && d < range) list.push({ p, d });
  }
  return list.sort((a, b) => a.d - b.d);
}

function chatty(p) {
  if (settings.chat === "low") return p.vis || p.cat === "hist" && !!p.more;
  return true;
}

export function whereWords(p, dir = S.dir) {
  const side = sideWord(p, dir);
  if (side) return p.vis ? `on your ${side}` : `off to your ${side}`;
  return p.vis ? "" : "nearby";
}

export function announceText(p, d, dir = S.dir) {
  const turn = detourSentence(p);
  if (turn) {
    // a turn-off (a mission a few miles off I-5): said at its exit, never "on your left/right"
    const s = d < 0.4 ? `${turn} ${p.text}` : `In about ${d < 1.5 ? "a mile" : `${Math.round(d)} miles`}, ${turn[0].toLowerCase()}${turn.slice(1)} ${p.text}`;
    return settings.kid && p.spot && p.vis ? `${s} I spy challenge: ${p.spot}` : s;
  }
  const where = whereWords(p, dir);
  let lead;
  if (d < 0.4) lead = where ? `Right now, ${where}` : "Right about here";
  else lead = `In about ${d < 1.5 ? "a mile" : `${Math.round(d)} miles`}${where ? `, ${where}` : ""}`;
  let s = `${lead}: ${p.name}. ${p.text}`;
  if (settings.kid && p.spot && p.vis) s += ` I spy challenge: ${p.spot}`;
  return s;
}

// Full stories reuse the recorded landmark sentences. The setting is read again when a queued announcement
// starts, so turning autoplay off also shortens introductions still waiting to play.
function landmarkText(p, d, dir) {
  const intro = announceText(p, d, dir);
  return settings.autoStories && p.more ? `${intro} ${p.more}` : intro;
}

function stillAhead(p) { return () => S.m != null && aheadOf(S.m, S.dir, p.m) > -0.6; }

function stampBetween(prev, m) {
  if (prev == null || m == null || Math.abs(m - prev) > 30) return;
  if (S.mode === "demo") return; // a demo drive is pretend: no stamps or badges (3.0.1)
  const lo = Math.min(prev, m) - 0.25, hi = Math.max(prev, m) + 0.25;
  let fresh = [];
  for (const p of PLACES) {
    if (p.m < lo) continue;
    if (p.m > hi) break;
    if (p.detour) continue;   // a turn-off counts only when you go there (stampNear) or say so (stampSelf)
    if (!S.stamps[p.id]) { S.stamps[p.id] = Date.now(); fresh.push(p); }
  }
  if (fresh.length) {
    saveStamps();
    for (const p of fresh) bus.emit("place:stamp", { place: p });
  }
}

const DETOUR_STAMP_MI = 0.5;   // a turn-off place is stamped when GPS comes this close to it
/** Every GPS fix (main.js, on I-5 or off it): stamp the turn-off places (missions off I-5) you have reached. */
export function stampNear(lat, lon, accuracy) {
  if (!isFinite(lat) || !isFinite(lon) || (accuracy && accuracy > 800)) return [];
  const fresh = [];
  for (const p of PLACES) {
    if (!p.detour || p.lat == null || S.stamps[p.id]) continue;
    if (miles(lat, lon, p.lat, p.lon) <= DETOUR_STAMP_MI) { S.stamps[p.id] = Date.now(); fresh.push(p); }
  }
  if (fresh.length) {
    saveStamps();
    for (const p of fresh) bus.emit("place:stamp", { place: p, how: "gps" });
  }
  return fresh;
}
/** "I went there" on a turn-off place's sheet. */
export function stampSelf(p) {
  if (!p || S.stamps[p.id]) return false;
  S.stamps[p.id] = Date.now();
  saveStamps();
  bus.emit("place:stamp", { place: p, how: "self" });
  return true;
}

function zoneLine(z) {
  const season = z.seasons && z.seasons[seasonOf()];
  return `Now passing: ${z.label}. ${z.text}${season ? " " + season : ""}`;
}

const STATE_WELCOME = {
  CA: "Welcome to California.",
  OR: "Welcome to Oregon. Exit numbers start over here, counting up from the California line.",
  WA: "Welcome to Washington. Exit numbers start over again, counting up from the Columbia River.",
};

function onPos(e) {
  if (!e || typeof e !== "object") return;
  const { m, prevM, jumped } = e;
  if (S.mode === "off" || m == null || !isFinite(m)) return;
  if (!jumped) stampBetween(prevM, m);
  if (S.offRoute) return;
  voice.prune();
  if (!settings.narr) return;
  const dir = S.dir;

  // state line
  const st = stateAt(m).id;
  if (lastState && st !== lastState && !jumped) {
    voice.say(`${STATE_WELCOME[st] || ""}`, { id: "state:" + st, prio: 3, chime: "success" });
    bus.emit("state:enter", { st });
  }
  lastState = st;

  // halfway between the two ends of the covered road (Mexico and the Oregon line)
  const half = MAX_M / 2;
  if (!halfwayDone && prevM != null && !jumped && (prevM - half) * (m - half) <= 0 && prevM !== m) {
    halfwayDone = true;
    voice.say(`You just crossed the halfway point of I-5${SCOPE.length === 1 ? " in " + STATES[0].name : ""}, about ${Math.round(half)} miles from both ${ENDS.S.short} and ${ENDS.N.short}.`, { id: "halfway", prio: 2, chime: "success" });
  }

  // a big climb ahead
  const sum = summitAhead(m, dir, 12);
  if (sum && sum.ft > 2500 && (!lastSummit || Math.abs(lastSummit - sum.m) > 15) && !jumped) {
    lastSummit = sum.m;
    const here = elevAt(m);
    voice.say(`The road climbs about ${Math.round((sum.ft - here) / 100) * 100} feet over the next ${Math.max(1, Math.round(Math.abs(sum.m - m)))} miles, to roughly ${sum.ft.toLocaleString()} feet.`, { id: "summit:" + sum.m, prio: 0 });
  }

  // landscape zone
  const z = zoneAt(m);
  if (z && z !== lastZone) {
    const first = lastZone === null;
    lastZone = z;
    const zk = z.from + "|" + dir;
    if (settings.zoneNarr && !first && !jumped && !toldZones.has(zk)) {
      toldZones.add(zk);
      voice.say(zoneLine(z), { id: "zone:" + z.from, prio: 0, check: () => zoneAt(S.m) === z });
    }
    bus.emit("zone", { zone: z });
  }

  // GPS just started and the direction isn't known yet (a parked phone has no heading; the saved one is from the last
  // trip): wait for it before announcing anything ahead, or the first places could be the ones behind the car.
  if (S.mode === "gps" && S.dirSure === false) return;

  // landmarks within the heads-up distance (at least ~75 seconds of warning at speed, but never more than 2 miles past
  // the setting: one bad speed reading must not pull in a whole stretch of road)
  const lead = Math.min(settings.lead + 2, Math.max(settings.lead, S.speed ? S.speed * 75 / 3600 : 0));
  for (const { p, d } of upcoming(m, dir, settings.cats, lead + 0.01)) {
    if (heard.has(hk(p.id, dir))) continue;
    heard.add(hk(p.id, dir));
    if (jumped && d < -0.1) continue;
    if (!chatty(p)) continue;
    lastSpokeAtM = m; lastSpokeAt = Date.now();
    voice.say(landmarkText(p, Math.max(0, d), dir), { id: p.id, prio: 1, chime: true, check: () => settings.narr && S.mode !== "off" && !S.offRoute && S.dir === dir && stillAhead(p)(),
      interruptible: true, // turns and urgent road information take priority over a long landmark story
      onstart: () => { if (settings.autoStories && p.more) told.add(p.id); },
      fresh: () => (S.m != null && S.dir === dir ? landmarkText(p, Math.max(0, aheadOf(S.m, dir, p.m)), dir) : null) });
    bus.emit("place:announce", { place: p, d });
  }

  // story time on quiet stretches ("high" chattiness only): 5 quiet miles or 4 quiet minutes. (It used to wait for 9
  // miles without a landmark, and no gap on the whole road is that long, so High never told a story.)
  const quiet = lastSpokeAtM != null && (Math.abs(m - lastSpokeAtM) > STORY_MI || (lastSpokeAt && Date.now() - lastSpokeAt > STORY_MS));
  if (settings.autoStories && settings.chat === "high" && !voice.isSpeaking() && !voice.queued().length && quiet) {
    const recent = PLACES.filter(p => p.more && (heard.has(hk(p.id, "N")) || heard.has(hk(p.id, "S"))) && !told.has(p.id)).sort((a, b) => Math.abs(a.m - m) - Math.abs(b.m - m))[0];
    if (recent) {
      told.add(recent.id);
      lastSpokeAtM = m; lastSpokeAt = Date.now();
      voice.say(`Here's a story while we drive, about ${recent.name}. ${recent.more}`, { id: "story:" + recent.id, prio: 0 });
    }
  }
}
bus.on("pos", onPos);
bus.on("mode", mode => { if (mode === "off") resetTrip(); });

// ---------- things the user can ask for ----------
export function tellMore(p) {
  if (!p) return;
  told.add(p.id);
  voice.say(p.more ? `${p.name}. ${p.more}` : `That's everything I have on ${p.name}. ${p.text}`, { now: true, id: "more:" + p.id });
}
export function hear(p) { if (p) voice.say(`${p.name}. ${p.text}`, { now: true, id: "hear:" + p.id }); }

/** The words for a question asked through Siri in the iPhone app (I5Native.swift): "left", "right", "where", or a
    service ("fuel", "food", "ev", "sleep", "rest"). The same answers the buttons speak; Siri says them, so nothing is
    queued here. */
export function answer(kind) {
  const said = [];
  const real = voice.say;
  voice.say = text => { said.push(String(text)); return Promise.resolve(true); };
  try {
    if (kind === "left" || kind === "right") look(kind);
    else if (kind === "where") whereAreWe();
    else tellServices(kind);
  } finally { voice.say = real; }
  return said.join(" ") || "I don't have an answer for that yet.";
}

export function look(side) {
  if (S.m == null) return voice.say("Start GPS or a demo drive first, then I can tell you what's out there.", { now: true });
  const cands = PLACES.filter(p => sideWord(p, S.dir) === side)
    .map(p => ({ p, d: aheadOf(S.m, S.dir, p.m) }))
    .filter(x => x.d > -3 && x.d < 8)
    .sort((a, b) => (Math.abs(a.d) - (a.p.vis ? 2 : 0)) - (Math.abs(b.d) - (b.p.vis ? 2 : 0)));
  const z = zoneAt(S.m);
  if (!cands.length) {
    return voice.say(z ? `On your ${side} right now: ${z.label}. ${z.text}` : `Nothing I know about on your ${side} for the next few miles.`, { now: true });
  }
  const { p, d } = cands[0];
  const where = d < -0.3 ? `Just behind us on your ${side}` : d < 0.5 ? `Right there on your ${side}` : `About ${Math.max(1, Math.round(d))} mile${Math.round(d) > 1 ? "s" : ""} up on your ${side}`;
  voice.say(`${where}: ${p.name}. ${p.text}`, { now: true, id: "look:" + p.id });
  bus.emit("place:look", { place: p });
}

export function whereAreWe() {
  if (S.m == null) return voice.say("I don't know where we are yet. Tap Start GPS.", { now: true });
  const st = stateAt(S.m), lm = localMile(S.m), z = zoneAt(S.m), r = regionAt(S.m), ft = elevAt(S.m);
  const parts = [`We're on I-5 in ${st.name}, near mile ${Math.round(lm.mi)}, heading ${S.dir === "N" ? "north" : "south"}.`];
  if (z) parts.push(`This stretch is ${z.label}.`); else parts.push(`This is ${r.name}.`);
  if (ft != null) parts.push(`Elevation about ${ft.toLocaleString()} feet.`);
  const toEnd = S.dir === "N" ? MAX_M - S.m : S.m;
  parts.push(`${Math.round(toEnd)} miles to ${(S.dir === "N" ? ENDS.N : ENDS.S).long}.`);
  voice.say(parts.join(" "), { now: true, id: "where" });
}

export function howFar(dest = S.dest) {
  if (!dest) return voice.say("Pick a destination first, on the Drive screen.", { now: true });
  const name = /border$/i.test(dest.name) ? "the " + dest.name : dest.name;  // "the Mexico border"
  const Name = name[0].toUpperCase() + name.slice(1);
  if (S.m == null) return voice.say(`${Name} is at mile ${Math.round(dest.m)} of I-5. Start GPS and I'll count down.`, { now: true });
  const d = Math.abs(dest.m - S.m);
  const mph = S.cruise && S.cruise > 25 ? S.cruise : S.speed && S.speed > 25 ? S.speed : 62;
  const n = upcoming(S.m, dest.m >= S.m ? "N" : "S", settings.cats, d).length;
  voice.say(d < 1 ? `We're there. This is ${name}.` : `${Name} is about ${Math.round(d)} miles away. That's around ${fmtDuration(d / mph)}, with ${n} landmarks to go.`, { now: true, id: "howfar" });
}

export function tellServices(kind = "fuel") {
  if (S.m == null) return voice.say("Start GPS first and I'll find the next stop.", { now: true });
  const word = { fuel: "gas", ev: "EV charging", food: "food", sleep: "a place to sleep" }[kind];
  if (kind === "rest") {
    const r = restAhead(S.m, S.dir, 1)[0];
    return voice.say(r ? `The next rest area on this side is ${r.name.replace(/\s*\((north|south)bound\)/i, "")}, in about ${Math.round(r.d)} miles.` : "I don't know of a rest area ahead on this side.", { now: true });
  }
  const s = servicesAhead(S.m, S.dir, kind, 2);
  if (!s.length) {
    // near an end of the covered road the data stops at the line, so don't promise "the next 120 miles"
    const left = S.dir === "N" ? MAX_M - S.m : S.m;
    return voice.say(left < 120 ? `I don't see ${word} between here and ${(S.dir === "N" ? ENDS.N : ENDS.S).long} in my data.`
      : `I don't see ${word} in the next 120 miles in my data. Plan ahead.`, { now: true });
  }
  const a = s[0];
  const names = (a[kind] || []).slice(0, 3).join(", ");
  voice.say(`Next ${word}: ${exitName(a.st, a.ref)}, in about ${Math.max(1, Math.round(a.d))} miles${names ? `: ${names}` : ""}.${s[1] ? ` After that, ${exitName(s[1].st, s[1].ref)} in ${Math.round(s[1].d)} miles.` : ""}`, { now: true });
}

export function nextOne() {
  const list = upcoming().filter(x => !heard.has(hk(x.p.id)) || x.d > 0.5);
  const x = list.find(x => voice.currentId() !== x.p.id) || list[0];
  if (x) { heard.add(hk(x.p.id)); voice.say(announceText(x.p, Math.max(0, x.d)), { now: true, id: x.p.id }); }
}

export function markHeard(id) { heard.add(hk(id)); }
export const narrator = { upcoming, announceText, whereWords, stampNear, stampSelf, tellMore, hear, look, whereAreWe, howFar, tellServices, nextOne, resetTrip, markHeard, answer, placeById, CATS, STATES };
