// What to say, and when. Listens to position updates and speaks through voice.js.
import { S, settings, bus, saveStamps } from "./store.js";
import {
  PLACES, CATS, MAX_M, STATES, ENDS, SCOPE, zoneAt, seasonOf, stateAt, sideWord, aheadOf, summitAhead, elevAt, regionAt,
  servicesAhead, restAhead, restName, exitName, fmtDurationSpoken, localMile, placeById, detourSentence, detourOf,
} from "./data.js";
import { miles } from "./geo.js";
import { voice } from "./voice.js";
import { t, loc } from "./i18n.js";
import { sideSaid } from "./data.js";

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

/** A place's story as narrated: its kids text with Stories for kids on (3.1.0; `kids`, the Spanish one in Spanish), else
    its text. */
export function storyOf(p) { return settings.kidStories && p && p.kids ? p.kids : p ? p.text : ""; }
/** The long story played after the introduction: none for a place told with its kids text (that is its whole story). */
export function moreOf(p) { return settings.kidStories && p && p.kids ? "" : p ? p.more || "" : ""; }
/** "a mile" / "12 miles" in the heads-up lines. */
const aboutDist = d => (d < 1.5 ? t("nar.a_mile") : t("nar.n_miles", { n: Math.round(d) }));

function chatty(p) {
  if (settings.chat === "low") return p.vis || p.cat === "hist" && !!p.more;
  return true;
}

export function whereWords(p, dir = S.dir) {
  const side = sideWord(p, dir);
  if (side) return p.vis ? t("nar.on_your_side", { side: sideSaid(side) }) : t("nar.off_to_your_side", { side: sideSaid(side) });
  return p.vis ? "" : t("nar.nearby");
}

/** A turn-off's own text opens with its exit ("Exit 54 is Highway 76 east, the way to Mission San Luis Rey, about four
    and a half miles inland."), which the turn sentence has just said, so the spoken line leaves that sentence out (3.0.7
    road test: the exit and the distance were said twice in a row). The sentences left are the ones recorded before, so
    the natural voice still has a clip for each; the place sheet keeps the whole text. */
function turnBody(p) {
  const d = detourOf(p), u = voice.speechUnits(p.text);
  const m = u.length > 1 && /^(?:Exit|La salida|Salida) (\d+[A-Z]?)\b/.exec(u[0]);
  return d && m && m[1] === d.exit ? u.slice(1).join(" ") : p.text;
}

export function announceText(p, d, dir = S.dir) {
  const turn = detourSentence(p);
  if (turn) {
    // a turn-off (a mission a few miles off I-5): said at its exit, never "on your left/right"
    const body = turnBody(p);
    const s = d < 0.4 ? `${turn} ${body}` : t("nar.in_about_dist_turn", { dist: aboutDist(d), turn: turn[0].toLowerCase() + turn.slice(1), body });
    return settings.kid && p.spot && p.vis ? `${s} ${t("nar.i_spy_challenge", { spot: p.spot })}` : s;
  }
  const where = whereWords(p, dir);
  let lead;
  if (d < 0.4) lead = where ? t("nar.right_now_where", { where }) : t("nar.right_about_here");
  else lead = where ? t("nar.in_about_dist_where", { dist: aboutDist(d), where }) : t("nar.in_about_dist", { dist: aboutDist(d) });
  let s = t("nar.lead_name_text", { lead, name: p.name, text: storyOf(p) });
  if (settings.kid && p.spot && p.vis) s += " " + t("nar.i_spy_challenge", { spot: p.spot });
  return s;
}

// Full stories reuse the recorded landmark sentences. The setting is read again when a queued announcement
// starts, so turning autoplay off also shortens introductions still waiting to play.
function landmarkText(p, d, dir) {
  const intro = announceText(p, d, dir);
  const more = moreOf(p);
  return settings.autoStories && more ? `${intro} ${more}` : intro;
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
  return t("nar.now_passing", { label: z.label, text: z.text }) + (season ? " " + season : "");
}

const STATE_WELCOME = {
  CA: t("nar.welcome_ca"),
  OR: t("nar.welcome_or"),
  WA: t("nar.welcome_wa"),
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
    const hv = { state: STATES[0].name, miles: Math.round(half), south: ENDS.S.short, north: ENDS.N.short };
    voice.say(SCOPE.length === 1 ? t("nar.halfway_in_state", hv) : t("nar.halfway", hv), { id: "halfway", prio: 1, chime: "success" });
  }

  // a big climb ahead. 3.0.7 (road test): queued behind a long story, this line played 4 to 6 miles late, with most of the
  // climb already behind the car. Now it is worded again from where the car is when it starts (fresh), and dropped once
  // the top is less than 2 miles ahead or less than 300 feet of climb is left (check; voice.prune runs it on every fix).
  const sum = summitAhead(m, dir, 12);
  if (sum && sum.ft > 2500 && (!lastSummit || Math.abs(lastSummit - sum.m) > 15) && !jumped) {
    lastSummit = sum.m;
    const top = sum.m, ft = sum.ft;
    const climbLine = at => {
      const n = Math.max(1, Math.round(Math.abs(top - at)));
      const cv = { feet: Math.round((ft - elevAt(at)) / 100) * 100, n, top: ft.toLocaleString(loc(undefined)) };
      return n === 1 ? t("nar.climb_one_mile", cv) : t("nar.climb_n_miles", cv);
    };
    voice.say(climbLine(m), { id: "summit:" + top, prio: 0,
      check: () => S.m != null && S.mode !== "off" && S.dir === dir && aheadOf(S.m, dir, top) >= 2 && ft - elevAt(S.m) >= 300,
      fresh: () => (S.m != null && S.dir === dir ? climbLine(S.m) : null) });
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
      onstart: () => { if (settings.autoStories && moreOf(p)) told.add(p.id); },
      fresh: () => (S.m != null && S.dir === dir ? landmarkText(p, Math.max(0, aheadOf(S.m, dir, p.m)), dir) : null) });
    bus.emit("place:announce", { place: p, d });
  }

  // story time on quiet stretches ("high" chattiness only): 5 quiet miles or 4 quiet minutes. (It used to wait for 9
  // miles without a landmark, and no gap on the whole road is that long, so High never told a story.)
  const quiet = lastSpokeAtM != null && (Math.abs(m - lastSpokeAtM) > STORY_MI || (lastSpokeAt && Date.now() - lastSpokeAt > STORY_MS));
  if (settings.autoStories && settings.chat === "high" && !voice.isSpeaking() && !voice.queued().length && quiet) {
    const recent = PLACES.filter(p => moreOf(p) && (heard.has(hk(p.id, "N")) || heard.has(hk(p.id, "S"))) && !told.has(p.id)).sort((a, b) => Math.abs(a.m - m) - Math.abs(b.m - m))[0];
    if (recent) {
      told.add(recent.id);
      lastSpokeAtM = m; lastSpokeAt = Date.now();
      // interruptible: a turn, a chain control or a road alert never waits minutes behind a story (code review 2026-11-20)
      voice.say(t("nar.story_time", { name: recent.name, more: moreOf(recent) }), { id: "story:" + recent.id, prio: 0, interruptible: true });
    }
  }
}
bus.on("pos", onPos);
bus.on("mode", mode => { if (mode === "off") resetTrip(); });

// ---------- things the user can ask for ----------
export function tellMore(p) {
  if (!p) return;
  told.add(p.id);
  voice.say(p.more ? t("nar.name_more", { name: p.name, more: p.more }) : t("nar.thats_everything", { name: p.name, text: storyOf(p) }), { now: true, id: "more:" + p.id, interruptible: true });
}
export function hear(p) { if (p) voice.say(t("nar.name_text", { name: p.name, text: storyOf(p) }), { now: true, id: "hear:" + p.id }); }

/** The words for a question asked through Siri in the iPhone app (I5Native.swift): "left", "right", "where", or a
    service ("fuel", "food", "ev", "sleep", "rest"). The same answers the buttons speak; Siri says them, so nothing is
    queued here. answer("ask", "how old is the mission") gives Ask Buddy's pre-written answer (data/ask.js, through
    js/listen.js's setAsker) for a free-form question, for the next iPhone build's Siri intent. */
let asker = null;
export function setAsker(fn) { asker = typeof fn === "function" ? fn : null; }
export function answer(kind, text) {
  if (kind === "ask") {
    let a = null;
    try { a = asker ? asker(String(text || "")) : null; } catch (e) { a = null; }
    return a || t("nar.no_answer_yet");
  }
  const said = [];
  const real = voice.say;
  voice.say = text => { said.push(String(text)); return Promise.resolve(true); };
  try {
    if (kind === "left" || kind === "right") look(kind);
    else if (kind === "where") whereAreWe();
    else tellServices(kind);
  } finally { voice.say = real; }
  return said.join(" ") || t("nar.no_answer_yet");
}

export function look(side) {
  if (S.m == null) return voice.say(t("nar.look_start_first"), { now: true });
  const cands = PLACES.filter(p => sideWord(p, S.dir) === side)
    .map(p => ({ p, d: aheadOf(S.m, S.dir, p.m) }))
    .filter(x => x.d > -3 && x.d < 8)
    .sort((a, b) => (Math.abs(a.d) - (a.p.vis ? 2 : 0)) - (Math.abs(b.d) - (b.p.vis ? 2 : 0)));
  const z = zoneAt(S.m);
  if (!cands.length) {
    return voice.say(z ? t("nar.look_zone", { side: sideSaid(side), label: z.label, text: z.text }) : t("nar.look_nothing", { side: sideSaid(side) }), { now: true });
  }
  const { p, d } = cands[0];
  const sv = { side: sideSaid(side), n: Math.max(1, Math.round(d)) };
  const where = d < -0.3 ? t("nar.look_behind", sv) : d < 0.5 ? t("nar.look_right_there", sv) : Math.round(d) > 1 ? t("nar.look_n_miles_up", sv) : t("nar.look_1_mile_up", sv);
  voice.say(t("nar.lead_name_text", { lead: where, name: p.name, text: storyOf(p) }), { now: true, id: "look:" + p.id });
  bus.emit("place:look", { place: p });
}

export function whereAreWe() {
  if (S.m == null) return voice.say(t("nar.where_unknown"), { now: true });
  const st = stateAt(S.m), lm = localMile(S.m), z = zoneAt(S.m), r = regionAt(S.m), ft = elevAt(S.m);
  const parts = [t("nar.where_on_i5", { state: st.name, mile: Math.round(lm.mi), heading: S.dir === "N" ? t("nar.north") : t("nar.south") })];
  if (z) parts.push(t("nar.where_stretch", { label: z.label })); else parts.push(t("nar.where_region", { name: r.name }));
  if (ft != null) parts.push(t("nar.where_elevation", { ft: ft.toLocaleString(loc(undefined)) }));
  const toEnd = S.dir === "N" ? MAX_M - S.m : S.m;
  parts.push(t("nar.where_to_end", { miles: Math.round(toEnd), end: (S.dir === "N" ? ENDS.N : ENDS.S).long }));
  voice.say(parts.join(" "), { now: true, id: "where" });
}

export function howFar(dest = S.dest) {
  if (!dest) return voice.say(t("nar.howfar_pick"), { now: true });
  const name = /border$/i.test(dest.name) ? t("nar.the_border", { name: dest.name }) : dest.name;  // "the Mexico border"
  const Name = name[0].toUpperCase() + name.slice(1);
  if (S.m == null) return voice.say(t("nar.howfar_at_mile", { name: Name, mile: Math.round(dest.m) }), { now: true });
  const d = Math.abs(dest.m - S.m);
  const mph = S.cruise && S.cruise > 25 ? S.cruise : S.speed && S.speed > 25 ? S.speed : 62;
  const n = upcoming(S.m, dest.m >= S.m ? "N" : "S", settings.cats, d).length;
  // the time in words (3.0.7 road test: "around 9 h 30 min" was read as letters or clipped)
  voice.say(d < 1 ? t("nar.howfar_there", { name }) : t("nar.howfar_away", { name: Name, miles: Math.round(d), time: fmtDurationSpoken(d / mph), n }), { now: true, id: "howfar" });
}

/** How far a stop is, for the voice: "just ahead", "in about a mile", "in about 12 miles" (3.0.7 road test: "Next gas: Exit
    120, in about 1 miles. After that, Exit 121 in 1 miles."). */
const inMiles = d => (d < 0.5 ? t("nar.just_ahead") : d < 1.5 ? t("nar.in_about_a_mile") : t("nar.in_about_n_miles", { n: Math.round(d) }));

export function tellServices(kind = "fuel") {
  if (S.m == null) return voice.say(t("nar.services_start_first"), { now: true });
  const word = { fuel: t("nar.word_gas"), ev: t("nar.word_ev"), food: t("nar.word_food"), sleep: t("nar.word_sleep") }[kind];
  if (kind === "rest") {
    const list = restAhead(S.m, S.dir, 1), r = list[0];
    const nm = x => restName(x.name); // no " - Southbound" / "(Southbound)" / " - NB": "on this side" says it (3.0.8)
    if (!r) return voice.say(t("nar.rest_none"), { now: true });
    // a Caltrans closure (tools/rest-status.json): say it, then the next open one on this side
    if (r.status === "closed") {
      const nx = list.find(x => x.status !== "closed");
      return voice.say(t("nar.rest_closed", { name: nm(r), dist: inMiles(r.d) }) + (nx ? " " + t("nar.rest_next", { name: nm(nx), dist: inMiles(nx.d) }) : ""), { now: true });
    }
    const note = r.status === "partial" ? " " + t("nar.rest_partly_closed") : r.status === "truck_only" ? " " + t("nar.rest_trucks_only") : "";
    return voice.say(t("nar.rest_next", { name: nm(r), dist: inMiles(r.d) }) + note, { now: true });
  }
  const s = servicesAhead(S.m, S.dir, kind, 2);
  if (!s.length) {
    // near an end of the covered road the data stops at the line, so don't promise "the next 120 miles"
    const left = S.dir === "N" ? MAX_M - S.m : S.m;
    return voice.say(left < 120 ? t("nar.services_none_to_end", { word, end: (S.dir === "N" ? ENDS.N : ENDS.S).long })
      : t("nar.services_none_120", { word }), { now: true });
  }
  const a = s[0];
  const names = (a[kind] || []).slice(0, 3).join(", ");
  voice.say(t("nar.services_next", { word, exit: exitName(a.st, a.ref), dist: inMiles(a.d) }) + (names ? `: ${names}` : "") + "." + (s[1] ? " " + t("nar.services_after_that", { exit: exitName(s[1].st, s[1].ref), dist: inMiles(s[1].d) }) : ""), { now: true });
}

export function nextOne() {
  const list = upcoming().filter(x => !heard.has(hk(x.p.id)) || x.d > 0.5);
  const x = list.find(x => voice.currentId() !== x.p.id) || list[0];
  if (x) { heard.add(hk(x.p.id)); voice.say(announceText(x.p, Math.max(0, x.d)), { now: true, id: x.p.id }); }
}

export function markHeard(id) { heard.add(hk(id)); }
export const narrator = { upcoming, announceText, storyOf, moreOf, whereWords, stampNear, stampSelf, tellMore, hear, look, whereAreWe, howFar, tellServices, nextOne, resetTrip, markHeard, answer, setAsker, placeById, CATS, STATES };
