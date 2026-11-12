// What to say, and when. Listens to position updates and speaks through voice.js.
import { S, settings, bus, saveStamps } from "./store.js";
import {
  PLACES, CATS, MAX_M, STATES, ENDS, SCOPE, zoneAt, seasonOf, stateAt, sideWord, aheadOf, summitAhead, elevAt, regionAt,
  servicesAhead, restAhead, exitName, fmtDuration, localMile, placeById,
} from "./data.js";
import { voice } from "./voice.js";

const heard = new Set();      // place ids announced this trip
const told = new Set();       // place ids whose "more" story was told this trip
let lastZone = null, lastState = null, lastSummit = null, halfwayDone = false;
let lastSpokeAtM = null;      // corridor mile of the last landmark announcement (for story time)

export function resetTrip() {
  heard.clear(); told.clear();
  lastZone = null; lastState = null; lastSummit = null; halfwayDone = false; lastSpokeAtM = null;
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
  const where = whereWords(p, dir);
  let lead;
  if (d < 0.4) lead = where ? `Right now, ${where}` : "Right about here";
  else lead = `In about ${d < 1.5 ? "a mile" : `${Math.round(d)} miles`}${where ? `, ${where}` : ""}`;
  let s = `${lead}: ${p.name}. ${p.text}`;
  if (settings.kid && p.spot && p.vis) s += ` I spy challenge: ${p.spot}`;
  return s;
}

function stillAhead(p) { return () => S.m != null && aheadOf(S.m, S.dir, p.m) > -0.6; }

function stampBetween(prev, m) {
  if (prev == null || m == null || Math.abs(m - prev) > 30) return;
  const lo = Math.min(prev, m) - 0.25, hi = Math.max(prev, m) + 0.25;
  let fresh = [];
  for (const p of PLACES) {
    if (p.m < lo) continue;
    if (p.m > hi) break;
    if (!S.stamps[p.id]) { S.stamps[p.id] = Date.now(); fresh.push(p); }
  }
  if (fresh.length) {
    saveStamps();
    for (const p of fresh) bus.emit("place:stamp", { place: p });
  }
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
    if (settings.zoneNarr && !first && !jumped) voice.say(zoneLine(z), { id: "zone:" + z.from, prio: 0, check: () => zoneAt(S.m) === z });
    bus.emit("zone", { zone: z });
  }

  // landmarks within the heads-up distance (at least ~75 seconds of warning at speed)
  const lead = Math.max(settings.lead, S.speed ? S.speed * 75 / 3600 : 0);
  for (const { p, d } of upcoming(m, dir, settings.cats, lead + 0.01)) {
    if (heard.has(p.id)) continue;
    heard.add(p.id);
    if (jumped && d < -0.1) continue;
    if (!chatty(p)) continue;
    lastSpokeAtM = m;
    voice.say(announceText(p, Math.max(0, d), dir), { id: p.id, prio: 1, chime: true, check: stillAhead(p) });
    bus.emit("place:announce", { place: p, d });
  }

  // story time on long quiet stretches ("high" chattiness only)
  if (settings.chat === "high" && !voice.isSpeaking() && !voice.queued().length && lastSpokeAtM != null && Math.abs(m - lastSpokeAtM) > 9) {
    const recent = PLACES.filter(p => p.more && heard.has(p.id) && !told.has(p.id)).sort((a, b) => Math.abs(a.m - m) - Math.abs(b.m - m))[0];
    if (recent) {
      told.add(recent.id);
      lastSpokeAtM = m;
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
  const mph = S.speed && S.speed > 25 ? S.speed : 62;
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
  const list = upcoming().filter(x => !heard.has(x.p.id) || x.d > 0.5);
  const x = list.find(x => voice.currentId() !== x.p.id) || list[0];
  if (x) { heard.add(x.p.id); voice.say(announceText(x.p, Math.max(0, x.d)), { now: true, id: x.p.id }); }
}

export function markHeard(id) { heard.add(id); }
export const narrator = { upcoming, announceText, whereWords, tellMore, hear, look, whereAreWe, howFar, tellServices, nextOne, resetTrip, markHeard, placeById, CATS, STATES };
