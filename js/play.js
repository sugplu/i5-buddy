// I-5 Buddy play module: the Play tab. A picker of game cards, then road bingo, trivia (classic and a speed round), I spy,
// and the games in js/games/: Plate Hunt, Higher or Lower, Where Is This?, Would You Rather, Scavenger Hunt, the Alphabet
// Game, Cow Count, and the Car Party scoreboard they share. Each of those loads when it is first opened (and is cached
// for offline play with the rest of the app).
// Owns #view-play (the whole Play tab) and #spotCard (the I spy cards on Drive, under the next-landmark card).
// Works offline, with no position (S.m === null), with no trivia or I spy data, and without other modules.
// Store keys: "bingo" (the current card), "trivia" ({right, asked, best}), "spy" ({points, found, missed}),
// "playGame" (last game picked on the Play tab), "playTripAt" (when this trip began, ms), "party" (Car Party),
// "triviaSpeed", "plates", "higher", "where", "wyr", "hunt", "alpha", "cows" (see each game's file).

import { t, loc } from "./i18n.js";
import * as i18n from "./i18n.js";
import { h, add, svg, safe, shuffle, num, icon, ICON, countUp, reduced, firstSentence, shortName, fmtDate, thousands, sameish, colorStyle, pick, clamp } from "./games/kit.js";
import { createParty } from "./games/party.js";
import { LINES as WORDS, WYR, wyrSpeech, alphaSpeech, ALPHA_TIPS } from "./games/lines.js";

let api = null;

const logo = cls => h("img", { class: cls, src: "icons/icon.svg", alt: "", draggable: "false" });
const LETTERS = ["A", "B", "C", "D", "E", "F"];

/* ---------- thin wrappers around the core (each one tolerates a missing piece) ---------- */
const S = () => api?.S || {};
const settings = () => api?.settings || {};
const D = () => api?.data || {};
function say(text, opts) { try { return api?.voice?.say?.(text, opts) || Promise.resolve(false); } catch { return Promise.resolve(false); } }
function chime(kind) { try { api?.voice?.chime?.(kind); } catch { /* no audio */ } }
function unlock() { try { api?.voice?.unlock?.(); } catch { /* no audio */ } }
function toast(t) { try { api?.ui?.toast?.(t); } catch { /* no toast */ } }
function buzz(pattern) { try { navigator.vibrate?.(pattern); } catch { /* no vibration (iOS) */ } }
const canSpeak = () => api?.voice?.available !== false;
function openPlace(p) { try { if (p) api?.ui?.placeSheet?.(p); } catch (e) { console.error("[play] placeSheet", e); } }
function store(key, fallback) { try { return api?.store ? api.store.get(key, fallback) : fallback; } catch { return fallback; } }
function save(key, value) { try { api?.store?.set?.(key, value); } catch { /* storage full or blocked */ } }
function aheadOf(m, dir, x) {
  try { if (D().aheadOf) return D().aheadOf(m, dir, x); } catch { /* fall through */ }
  return dir === "S" ? m - x : x - m;
}
function placeById(id) {
  if (typeof id !== "string") return null;
  try { if (D().placeById) return D().placeById(id) || null; } catch { /* fall through */ }
  return (Array.isArray(D().PLACES) ? D().PLACES : []).find(p => p && p.id === id) || null;
}
function sideOf(p) {
  try { return D().sideWord?.(p, S().dir) || ""; } catch { return ""; }
}
function regionName(m) {
  try { const r = D().regionAt?.(m); if (r && r.name) return r.name; } catch { /* no regions */ }
  try { const s = D().stateAt?.(m); if (s && s.name) return s.name; } catch { /* no states */ }
  return "";
}
/** "mile 309" in California, "OR mile 55" in a state that restarts the count (as on the Drive screen). */
function mileLabel(m) {
  if (m == null || !isFinite(m)) return "";
  try { const lm = D().localMile?.(m); if (lm) return `${lm.st && lm.st !== "CA" ? lm.st + " " : ""}mile ${Math.round(lm.mi)}`; } catch { /* below */ }
  return `mile ${Math.round(m)}`;
}
function seasonNow() {
  try { return D().seasonOf ? D().seasonOf(new Date()) : null; } catch { return null; }
}
const driving = () => S().mode === "gps" || S().mode === "demo";
/** Corridor mile where the road ends (the Oregon line on the California-only road); Infinity without road data. */
function roadEnd() {
  const st = Array.isArray(D().STATES) ? D().STATES : [];
  return num(D().MAX_M, num(st.length && st[st.length - 1] ? st[st.length - 1].to : NaN, Infinity));
}
/** A position on this road. (A mile saved when the app covered more of I-5, say 1300 in Washington, is none.) */
const hasPos = () => S().m != null && isFinite(S().m) && S().m >= -1 && S().m <= roadEnd() + 1;

/* ---------- speech: the games never trample the guide ----------
   voice.say({now: true}) cuts what is speaking and drops ordinary waiting lines such as landmark announcements
   (urgent prio >= 2 items like chain-control or severe-weather warnings survive and are re-queued). So a game line
   only interrupts our own speech, or silence. When anything else is speaking or waiting, it queues at prio 2: after the
   current item and any warnings already waiting, ahead of ordinary narration (prio 1). Every line carries a stable
   "play:" id (listen.js looks for that prefix) and, where it can go stale, a check(). */
const ours = id => String(id ?? "").startsWith("play:");
function voiceBusy() {
  try {
    const v = api?.voice;
    if (!v) return false;
    if (v.isSpeaking?.() && !ours(v.currentId?.())) return true;
    const q = v.queued?.();
    return Array.isArray(q) && q.some(id => !ours(id));
  } catch { return true; }
}
let sayGen = 0;
let settle = null;   // while one of our interrupted lines winds down inside voice.js
function gameSay(text, id, extra = {}) {
  const gen = ++sayGen;
  const speak = () => (gen !== sayGen ? false   // a newer game line took over
    : say(text, voiceBusy() ? { ...extra, id, prio: 2 } : { ...extra, id, now: true }));
  if (voiceBusy()) return say(text, { ...extra, id, prio: 2 });
  if (settle) return settle.then(speak);
  let playing = false;
  try { playing = !!api?.voice?.isSpeaking?.(); } catch { /* no voice */ }
  if (!playing) return Promise.resolve(speak());   // nothing playing: nothing to cut (drops only our own queued line)
  // One of our own lines is playing. voice.js finishes an interrupted item late (when the engine reports
  // "interrupted", which can come after the next item started) and then clears its `current`, losing track of what
  // is speaking. So stop ours, wait for that late finish (or half a second: iOS may never report it), then speak.
  settle = new Promise(resolve => {
    let done = false, off = null;
    const go = () => {
      if (done) return;
      done = true;
      try { off && off(); } catch { /* bus gone */ }
      setTimeout(() => { settle = null; resolve(); }, 30);
    };
    // listen first: voice.js may report the stop synchronously
    try { off = api.bus?.on?.("speaking", s => { if (!s) go(); }) || null; } catch { off = null; }
    try { api.voice.stop(); } catch { /* nothing to stop */ }
    setTimeout(go, 500);
  });
  return settle.then(speak);
}

/* Screen-reader announcements. One polite status line on Drive (inside #spotCard) and one on the Play view;
   whichever is on screen speaks. Cards themselves are not live regions (their distance ticks every GPS fix). */
const sr = { drive: null, view: null, pending: [], timer: 0 };
function announce(msg) {
  if (!msg) return;
  sr.pending.push(msg);
  clearTimeout(sr.timer);
  for (const el of [sr.drive, sr.view]) if (el) el.textContent = "";
  sr.timer = setTimeout(() => {
    const text = sr.pending.join(" ");
    sr.pending = [];
    for (const el of [sr.drive, sr.view]) if (el) el.textContent = text;
  }, 120);
}

/* ---------- road bingo: square pools ----------
   "emoji|label", "emoji|label|seasons" or "emoji|label|seasons|tags". seasons: comma list of winter, spring,
   summer, fall. tags: squares that share a tag are one sighting (a crop duster IS an airplane), so a card never
   gets two of them. A general square carries the tags of the specific ones it covers ("Snow-capped peak" vs
   "Mount Hood"). Labels stay short so they fit a 60px square on a 360px phone; "~" marks where a long word may
   break (a soft hyphen). Emoji are Unicode 9 or older so Android 8 and up draws all of them. */
/** A square for the pools: its spec ("emoji|label|seasons|tags"; the seasons and tags stay as written, the code reads them)
    with the label in this language (3.1.0; "~" in a label marks where a long word may break). */
const sq = (spec, label) => { const p = String(spec).split("|"); if (label) p[1] = String(label).replace(/\|/g, "/"); return p.join("|"); };
const POOLS = {
  general: [
    sq("🚐|RV", t("play.sq_rv")), sq("🚘|Out-of-state plate", t("play.sq_out_of_state_plate")), sq("🚓|Highway patrol", t("play.sq_highway_patrol")), sq("🚻|Rest area", t("play.sq_rest_area")), sq("🌉|Bridge over a river||bridge", t("play.sq_bridge_over_a_river")), sq("🐴|Horse", t("play.sq_horse")),
    sq("🏍️|Motor~cycle", t("play.sq_motorcycle")), sq("🚛|Big rig, 3 trailers", t("play.sq_big_rig_3_trailers")), sq("🚌|School bus", t("play.sq_school_bus")), sq("🐕|Dog in a car", t("play.sq_dog_in_a_car")), sq("🚒|Fire truck", t("play.sq_fire_truck")), sq("🚲|Bikes on a car", t("play.sq_bikes_on_a_car")),
    sq("🚤|Boat on a trailer", t("play.sq_boat_on_a_trailer")), sq("🦅|Hawk on a post", t("play.sq_hawk_on_a_post")), sq("🚂|Freight train||freight", t("play.sq_freight_train")), sq("🏚️|Old barn", t("play.sq_old_barn")), sq("💧|Water tower", t("play.sq_water_tower")),
    sq("🌲|Fake-tree cell tower", t("play.sq_fake_tree_cell_tower")), sq("🇺🇸|Giant flag", t("play.sq_giant_flag")), sq("📦|Roof box on a car", t("play.sq_roof_box_on_a_car")), sq("🚧|Orange cones", t("play.sq_orange_cones")), sq("🚕|Yellow car", t("play.sq_yellow_car")),
    sq("💜|Purple car", t("play.sq_purple_car")), sq("🚗|Car towing a car", t("play.sq_car_towing_a_car")), sq("⚡|EV charger sign", t("play.sq_ev_charger_sign")), sq("🔟|Milepost ending in 0", t("play.sq_milepost_ending_in_0")), sq("🌈|Rainbow", t("play.sq_rainbow")),
    sq("🦌|Deer crossing sign", t("play.sq_deer_crossing_sign")), sq("⛽|Gas price sign", t("play.sq_gas_price_sign")), sq("🍔|Burger sign", t("play.sq_burger_sign")), sq("🚁|Heli~copter", t("play.sq_helicopter")), sq("🏞️|Lake||lake", t("play.sq_lake")), sq("🏎️|Sports car", t("play.sq_sports_car")),
    sq("🚚|Moving truck", t("play.sq_moving_truck")), sq("✈️|Airplane||plane", t("play.sq_airplane")), sq("🐦|Birds on a wire", t("play.sq_birds_on_a_wire")), sq("🚙|Pickup with hay", t("play.sq_pickup_with_hay")), sq("🚨|Car pulled over", t("play.sq_car_pulled_over")),
  ],
  socal: [
    sq("🌴|Palm trees", t("play.sq_palm_trees")), sq("🏄|Surf~board on a car", t("play.sq_surfboard_on_a_car")), sq("🛣️|Sign with 4+ exits", t("play.sq_sign_with_4_exits")), sq("🔷|Carpool lane", t("play.sq_carpool_lane")), sq("🌊|Ocean view", t("play.sq_ocean_view")),
    sq("🚆|Commuter train", t("play.sq_commuter_train")), sq("🛬|Plane landing||plane", t("play.sq_plane_landing")), sq("🌮|Taco shop", t("play.sq_taco_shop")), sq("🎢|Roller coaster", t("play.sq_roller_coaster")), sq("🏟️|Stadium", t("play.sq_stadium")),
    sq("🏗️|Con~struction crane", t("play.sq_construction_crane")), sq("🎨|Mural", t("play.sq_mural")), sq("😎|Con~vertible", t("play.sq_convertible")), sq("🚦|Stop-and-go traffic", t("play.sq_stop_and_go_traffic")), sq("🛍️|Outlet mall", t("play.sq_outlet_mall")),
    sq("🌺|Flower~ing vines", t("play.sq_flowering_vines")), sq("🚢|Big ship||ship", t("play.sq_big_ship")), sq("🌵|Cactus", t("play.sq_cactus")), sq("🍊|Orange tree", t("play.sq_orange_tree")), sq("🍃|Ivy on a sound wall", t("play.sq_ivy_on_a_sound_wall")), sq("🚗|Lowrider", t("play.sq_lowrider")),
  ],
  westside: [
    sq("🛢️|Oil pumpjack", t("play.sq_oil_pumpjack")), sq("🌳|Almond orchard", t("play.sq_almond_orchard")), sq("🐂|Cattle||cattle", t("play.sq_cattle")), sq("🌊|Aqueduct", t("play.sq_aqueduct")), sq("🍅|Tomato truck", t("play.sq_tomato_truck")),
    sq("🛩️|Crop duster||plane", t("play.sq_crop_duster")), sq("🌪️|Dust devil", t("play.sq_dust_devil")), sq("🌾|Hay bales", t("play.sq_hay_bales")), sq("🐝|Bee boxes", t("play.sq_bee_boxes")), sq("🥜|Pista~chio trees", t("play.sq_pistachio_trees")), sq("☁️|Cotton field", t("play.sq_cotton_field")),
    sq("🍇|Vineyard", t("play.sq_vineyard")), sq("💦|Sprin~klers on", t("play.sq_sprinklers_on")), sq("🚰|Farm water sign", t("play.sq_farm_water_sign")), sq("🚜|Tractor", t("play.sq_tractor")), sq("🍑|Fruit stand", t("play.sq_fruit_stand")), sq("🌬️|Wind turbines", t("play.sq_wind_turbines")),
    sq("🐑|Sheep", t("play.sq_sheep")), sq("🌿|Tumble~weed", t("play.sq_tumbleweed")), sq("👃|Smelly feedlot||cattle", t("play.sq_smelly_feedlot")), sq("🚚|Garlic truck", t("play.sq_garlic_truck")), sq("🏜️|Bare brown hills", t("play.sq_bare_brown_hills")), sq("☀️|Road mirage", t("play.sq_road_mirage")),
  ],
  delta: [
    sq("⛵|Sailboat", t("play.sq_sailboat")), sq("🌉|Draw~bridge||bridge", t("play.sq_drawbridge")), sq("🏛️|Capitol dome", t("play.sq_capitol_dome")), sq("🌽|Corn field", t("play.sq_corn_field")), sq("🍐|Pear orchard", t("play.sq_pear_orchard")), sq("🍇|Vineyard", t("play.sq_vineyard")),
    sq("🦆|Ducks on water||duck", t("play.sq_ducks_on_water")), sq("🛶|Kayak", t("play.sq_kayak")), sq("🚢|Cargo ship||ship", t("play.sq_cargo_ship")), sq("🌾|Levee road", t("play.sq_levee_road")), sq("🌻|Sun~flowers|summer", t("play.sq_sunflowers")),
    sq("🐄|Dairy cows||cattle", t("play.sq_dairy_cows")), sq("🍒|Cherry orchard", t("play.sq_cherry_orchard")), sq("🛫|Jet taking off||plane", t("play.sq_jet_taking_off")), sq("🌳|Giant oak tree", t("play.sq_giant_oak_tree")), sq("🎣|Someone fishing", t("play.sq_someone_fishing")),
    sq("🚂|Train bridge||bridge", t("play.sq_train_bridge")), sq("🕊️|Swan", t("play.sq_swan")),
  ],
  valley: [
    sq("🌾|Rice field||rice", t("play.sq_rice_field")), sq("🌻|Sun~flowers|summer", t("play.sq_sunflowers")), sq("🌰|Walnut orchard", t("play.sq_walnut_orchard")), sq("🕊️|White egret", t("play.sq_white_egret")), sq("🌿|Olive trees", t("play.sq_olive_trees")), sq("🦆|Ducks||duck", t("play.sq_ducks")),
    sq("🍑|Peach orchard", t("play.sq_peach_orchard")), sq("🌸|Prune orchard", t("play.sq_prune_orchard")), sq("⛰️|Sutter Buttes", t("play.sq_sutter_buttes")), sq("💧|Flooded field||rice", t("play.sq_flooded_field")), sq("🛩️|Crop duster||plane", t("play.sq_crop_duster")),
    sq("🏔️|Snowy peak far off||peak,hood,rainier,baker", t("play.sq_snowy_peak_far_off")), sq("🐄|Dairy cows||cattle", t("play.sq_dairy_cows")), sq("🍯|Honey sign", t("play.sq_honey_sign")), sq("🌳|Almond orchard", t("play.sq_almond_orchard")),
    sq("🍉|Melon stand", t("play.sq_melon_stand")), sq("🦅|Bald eagle", t("play.sq_bald_eagle")), sq("🐐|Goats", t("play.sq_goats")), sq("🚜|Tractor", t("play.sq_tractor")),
  ],
  shasta: [
    sq("🏔️|Snow-capped peak||peak,hood,rainier,baker", t("play.sq_snow_capped_peak")), sq("🚛|Log truck", t("play.sq_log_truck")), sq("🚂|Train in the canyon||freight", t("play.sq_train_in_the_canyon")), sq("⛓️|Chain-up area", t("play.sq_chain_up_area")),
    sq("🌲|Pine forest||conifer", t("play.sq_pine_forest")), sq("🌉|Tall bridge||bridge", t("play.sq_tall_bridge")), sq("🛥️|House~boat||lake", t("play.sq_houseboat")), sq("💦|Water~fall", t("play.sq_waterfall")), sq("🦌|Deer", t("play.sq_deer")),
    sq("🚧|Runaway truck ramp", t("play.sq_runaway_truck_ramp")), sq("🛑|Brake check area", t("play.sq_brake_check_area")), sq("🌊|River rapids", t("play.sq_river_rapids")), sq("⛰️|Rocky spires", t("play.sq_rocky_spires")), sq("🔥|Burned trees", t("play.sq_burned_trees")),
    sq("❄️|Snow on the ground|winter,spring", t("play.sq_snow_on_the_ground")), sq("⛺|Camp~ground sign", t("play.sq_campground_sign")), sq("📈|Ele~vation sign", t("play.sq_elevation_sign")), sq("🦅|Osprey nest", t("play.sq_osprey_nest")), sq("🌫️|Fog in the trees", t("play.sq_fog_in_the_trees")),
  ],
  oregon: [
    sq("🌲|Douglas fir||conifer", t("play.sq_douglas_fir")), sq("🌉|Covered bridge sign", t("play.sq_covered_bridge_sign")), sq("🌰|Hazelnut orchard", t("play.sq_hazelnut_orchard")), sq("🌾|Grass seed field", t("play.sq_grass_seed_field")),
    sq("🎄|Christ~mas tree farm", t("play.sq_christmas_tree_farm")), sq("🛶|River rafters", t("play.sq_river_rafters")), sq("🍇|Vineyard", t("play.sq_vineyard")), sq("🐑|Sheep", t("play.sq_sheep")), sq("🌧️|Rain", t("play.sq_rain")), sq("🏈|Beaver logo", t("play.sq_beaver_logo")),
    sq("🦆|Duck logo", t("play.sq_duck_logo")), sq("⛽|Gas at~tendant", t("play.sq_gas_attendant")), sq("🚛|Log truck", t("play.sq_log_truck")), sq("🏔️|Mount Hood||hood", t("play.sq_mount_hood")), sq("🍓|Marion~berry sign", t("play.sq_marionberry_sign")),
    sq("🔵|Blue~berry farm", t("play.sq_blueberry_farm")), sq("🏭|Lumber mill", t("play.sq_lumber_mill")), sq("🐄|Dairy cows||cattle", t("play.sq_dairy_cows")), sq("🍺|Brewery sign", t("play.sq_brewery_sign")), sq("🌿|Hops on poles", t("play.sq_hops_on_poles")),
    sq("🦌|Elk crossing sign", t("play.sq_elk_crossing_sign")), sq("🐟|Salmon sign", t("play.sq_salmon_sign")),
  ],
  washington: [
    sq("⛴️|Ferry sign", t("play.sq_ferry_sign")), sq("🏔️|Mount Rainier||rainier", t("play.sq_mount_rainier")), sq("🌲|Ever~green trees||conifer", t("play.sq_evergreen_trees")), sq("🌷|Tulip field|spring", t("play.sq_tulip_field")), sq("🌧️|Rain", t("play.sq_rain")),
    sq("☕|Coffee stand", t("play.sq_coffee_stand")), sq("🦅|Bald eagle", t("play.sq_bald_eagle")), sq("🏙️|Space Needle", t("play.sq_space_needle")), sq("🏗️|Port cranes", t("play.sq_port_cranes")), sq("🚇|Light rail train", t("play.sq_light_rail_train")),
    sq("🌉|Double-deck bridge||bridge", t("play.sq_double_deck_bridge")), sq("🍁|BC license plate", t("play.sq_bc_license_plate")), sq("🕊️|Snow geese|fall,winter", t("play.sq_snow_geese")), sq("✈️|Big jet overhead||plane", t("play.sq_big_jet_overhead")),
    sq("🔵|Blue~berry farm", t("play.sq_blueberry_farm")), sq("🐄|Dairy cows||cattle", t("play.sq_dairy_cows")), sq("🍎|Apple stand", t("play.sq_apple_stand")), sq("🌿|Mossy trees", t("play.sq_mossy_trees")), sq("🐟|Salmon sign", t("play.sq_salmon_sign")),
    sq("🌊|Puget Sound view", t("play.sq_puget_sound_view")), sq("🏔️|Mount Baker||baker", t("play.sq_mount_baker")), sq("🏟️|Stadium", t("play.sq_stadium")),
  ],
};
const AREA_OF_REGION = {
  sd: "socal", la: "socal", ws: "westside", dc: "delta", sv: "valley", sh: "shasta",
  rv: "oregon", um: "oregon", wv: "oregon", sw: "washington", ps: "washington", ns: "washington",
};
const AREA_NAME = {
  socal: t("play.socal_city"), westside: t("play.westside_farm_country"), delta: t("play.delta_capital"), valley: t("play.sacramento_valley"),
  shasta: t("play.shasta_mountains"), oregon: t("play.oregon"), washington: t("play.washington"), mix: t("play.whole_road_mix"),
};
const AREA_IN = {
  socal: t("play.southern_california"), westside: t("play.westside_farm_country"), delta: t("play.the_delta"), valley: t("play.the_sacramento_valley"),
  shasta: t("play.the_shasta_mountains"), oregon: t("play.oregon"), washington: t("play.washington"),
};
const AREA_ORDER = ["socal", "westside", "delta", "valley", "shasta", "oregon", "washington"];
const AREA_STATE = { socal: "CA", westside: "CA", delta: "CA", valley: "CA", shasta: "CA", oregon: "OR", washington: "WA" };
/** The bingo areas on this road, in road order: those whose passport regions are in the data (the California-only
    road has no Oregon or Washington squares; set tools/build.py back to the whole road and they come back).
    Without regions, the states in the data decide; with no road data at all, every area. */
let areaList = null;
function areas() {
  if (areaList) return areaList;
  let list = [];
  try {
    const R = Array.isArray(D().REGIONS) ? D().REGIONS : [];
    list = AREA_ORDER.filter(a => R.some(r => r && AREA_OF_REGION[r.id] === a));
    if (!list.length) {
      const sts = (Array.isArray(D().STATES) ? D().STATES : []).map(s => s && s.id);
      list = AREA_ORDER.filter(a => sts.includes(AREA_STATE[a]));
    }
  } catch { list = []; }
  return (areaList = list.length ? list : AREA_ORDER.slice());
}
/** The squares (labels as stored on a card) that fit this road: the general pool and the areas on it. */
function homeSquares() {
  return new Set(["general", ...areas()].flatMap(a => POOLS[a] || []).map(s => parseSquare(s).t));
}

function parseSquare(s) {
  const [e, t, when, tags] = String(s).split("|");
  return {
    e: e || "", t: (t || e || "").replace(/~/g, "\u00AD"),
    when: when ? when.split(",") : null,
    g: tags ? tags.split(",").map(x => x.trim()).filter(Boolean) : [],
  };
}
/** Which bingo area a corridor mile belongs to (null when unknown). */
function areaAt(m) {
  if (m == null || !isFinite(m)) return null;
  try { const r = D().regionAt?.(m); if (r && AREA_OF_REGION[r.id]) return AREA_OF_REGION[r.id]; } catch { /* below */ }
  let st = null;
  try { st = D().stateAt?.(m)?.id || null; } catch { /* below */ }
  if (st === "OR") return "oregon";
  if (st === "WA") return "washington";
  if (st === "CA") return m < 215 ? "socal" : m < 460 ? "westside" : m < 560 ? "delta" : m < 665 ? "valley" : "shasta";
  return null;
}

/* ---------- road bingo: the card ---------- */
const CENTER = 12;
const LINES = (() => {
  const L = [];
  for (let r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map(c => r * 5 + c));
  for (let c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map(r => r * 5 + c));
  L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return L;
})();
const lineName = i => (i < 5 ? t("play.row_x1", { x1: i + 1 }) : i < 10 ? t("play.x1_column", { x1: "BINGO"[i - 5] }) : t("play.diagonal"));

let card = null;
let B = null;          // bingo DOM refs
let winEl = null, winTimer = 0;

function validCard(c) {
  return !!c && c.v === 2 && Array.isArray(c.cells) && c.cells.length === 25 && Array.isArray(c.on) && c.on.length === 25 &&
    c.cells.every(x => x && typeof x.t === "string") && Array.isArray(c.won);
}

/** 24 unique squares: mostly from the area you're in, a few from the area the road takes you next, the rest
    from the general pool. With no position, a mix from the whole road. Never two squares for one sighting. */
function dealCard() {
  const m = hasPos() ? S().m : null, dir = S().dir === "S" ? "S" : "N";
  const season = seasonNow();
  const fits = sq => !sq.when || !season || sq.when.includes(season);
  const pool = name => shuffle((POOLS[name] || []).map(parseSquare).filter(fits));
  const area = m != null ? areaAt(m) : null;
  const picks = [], seen = new Set(), used = new Set();
  const take = (list, n) => {
    for (const sq of list) {
      if (n <= 0) break;
      if (!sq.t || seen.has(sq.t) || sq.g.some(x => used.has(x))) continue;
      seen.add(sq.t);
      for (const x of sq.g) used.add(x);
      picks.push(sq); n--;
    }
  };
  if (area) {
    take(pool(area), 14);
    const ahead = areaAt(Math.max(0, Math.min(roadEnd(), m + (dir === "S" ? -45 : 45))));   // (never past the end of the road)
    if (ahead && ahead !== area) take(pool(ahead), 3);
  } else {
    for (const a of shuffle(areas().slice())) take(pool(a), 2);
  }
  take(pool("general"), 24 - picks.length);
  for (const a of areas()) if (picks.length < 24) take(pool(a), 24 - picks.length);
  const cells = shuffle(picks.slice(0, 24)).map(sq => ({ e: sq.e, t: sq.t }));
  cells.splice(CENTER, 0, { free: true, e: "", t: t("play.free") });
  return {
    v: 2, area: area || "mix", m: m != null ? Math.round(m * 10) / 10 : null, at: Date.now(),
    cells, on: cells.map((_, i) => i === CENTER), won: [], full: false,
  };
}
function loadCard() {
  const c = store("bingo", null);
  if (validCard(c) && cardFits(c)) {
    card = c; card.on[CENTER] = true;
    if (tidyCard(card)) save("bingo", card);
    return;
  }
  // nothing saved yet, a card from the old version of the app, or one dealt for a stretch this road doesn't cover
  card = dealCard();
  save("bingo", card);
}
/** A saved card dealt for an area on this road (or a whole-road mix). One dealt in Oregon when the app covered it is not. */
const cardFits = c => (c.area === "mix" || areas().includes(c.area)) && (c.m == null || (isFinite(c.m) && c.m <= roadEnd() + 1));
/** Swap the unmarked squares that only belong to areas this road doesn't reach (a card saved when the app covered
    Oregon and Washington: Mount Hood on a card dealt near the Oregon line, the Space Needle in a whole-road mix) for
    squares from here. Marked squares stay: somebody saw that. True if the card changed. */
function tidyCard(c) {
  const home = homeSquares();
  const odd = c.cells.map((x, i) => (i !== CENTER && !c.on[i] && !home.has(x.t) ? i : -1)).filter(i => i >= 0);
  if (!odd.length) return false;
  const tagsOf = new Map();   // label -> the sighting tags it carries, from every pool
  for (const s of Object.values(POOLS).flat()) { const sq = parseSquare(s); if (sq.g.length) tagsOf.set(sq.t, sq.g); }
  const seen = new Set(), used = new Set();
  c.cells.forEach((x, i) => { if (odd.includes(i)) return; seen.add(x.t); for (const g of tagsOf.get(x.t) || []) used.add(g); });
  const season = seasonNow();
  const deal = name => shuffle((POOLS[name] || []).map(parseSquare).filter(sq => !sq.when || !season || sq.when.includes(season)));
  const cand = [...(areas().includes(c.area) ? deal(c.area) : []), ...deal("general"), ...shuffle(areas().slice()).flatMap(deal)];
  let changed = false;
  for (const i of odd) {
    const sq = cand.find(s => s.t && !seen.has(s.t) && !s.g.some(g => used.has(g)));
    if (!sq) continue;
    c.cells[i] = { e: sq.e, t: sq.t };
    seen.add(sq.t);
    for (const g of sq.g) used.add(g);
    changed = true;
  }
  return changed;
}
const fullLines = () => LINES.map((l, i) => (l.every(k => card.on[k]) ? i : -1)).filter(i => i >= 0);
const marked = () => card.on.filter(Boolean).length - 1;

function toggleSquare(i) {
  if (!card || i === CENTER || !card.cells[i]) return;
  card.on[i] = !card.on[i];
  const fresh = fullLines().filter(l => !card.won.includes(l));
  if (fresh.length) card.won.push(...fresh);
  const blackout = card.on.every(Boolean) && !card.full;
  if (blackout) card.full = true;
  save("bingo", card);
  renderBingo(fresh);
  if (B) B.live.textContent = t("play.replace_x1_marked_of_24", { replace: card.cells[i].t.replace(/\u00AD/g, ""), x1: card.on[i] ? t("play.marked") : t("play.cleared"), marked: marked() });
  if (blackout) celebrate("full", fresh);
  else if (fresh.length) celebrate("bingo", fresh);
}

function newCard() {
  closeWin();
  card = dealCard();
  save("bingo", card);
  const refocus = !!B && B.confirm.contains(document.activeElement);
  if (B) B.confirm.hidden = true;
  renderBingo();
  if (refocus) B.newBtn.focus({ preventScroll: true });   // the confirm box is gone; don't drop focus on <body>
}
function askNewCard() {
  if (!card || marked() === 0) return newCard();
  B.confirm.hidden = false;
  const keep = B.confirm.querySelectorAll("button")[1];   // focus the safe choice
  keep && keep.focus({ preventScroll: true });
  try { B.confirm.scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }   // the banner asks from above the card
}

function buildBingo(pane) {
  const meta = h("div", { class: "pl-bmeta" });
  const banner = h("div", { class: "pl-banner", hidden: true });
  const grid = h("div", { class: "pl-grid", role: "group", "aria-label": t("play.bingo_card") });
  grid.addEventListener("click", safe(e => {
    const b = e.target.closest("button[data-i]");
    if (b) toggleSquare(+b.dataset.i);
  }, "bingo tap"));
  const head = h("div", { class: "pl-bhead", "aria-hidden": "true" }, [..."BINGO"].map(ch => h("span", null, ch)));
  const confirm = h("div", { class: "pl-confirm", hidden: true, role: "group", "aria-label": t("play.start_a_new_card") },
    h("p", null, t("play.start_over_with_a_new_card_this_one")),
    h("div", { class: "pl-row" },
      h("button", { class: "primary", type: "button", onclick: safe(newCard, "new card") }, t("play.new_card")),
      h("button", { class: "secondary", type: "button", onclick: () => { confirm.hidden = true; B.newBtn.focus({ preventScroll: true }); } }, t("play.keep_this_one"))));
  const newBtn = h("button", { class: "secondary pl-new", type: "button", onclick: safe(askNewCard, "new card") }, icon("shuffle"), t("play.new_card"));
  pane.append(meta, banner, h("div", { class: "pl-card" }, head, grid), confirm,
    h("div", { class: "pl-bfoot" }, h("p", { class: "pl-how" }, t("play.tap_a_square_when_someone_in_the_car")), newBtn));
  const live = h("p", { class: "pl-sr", role: "status" });
  pane.append(live);
  B = { pane, meta, banner, grid, newBtn, confirm, live };
}

function renderBingo(fresh = []) {
  if (!B) return;
  if (!card) loadCard();
  const grid = B.grid;
  if (grid.dataset.card !== String(card.at)) {
    grid.dataset.card = String(card.at);
    grid.textContent = "";
    card.cells.forEach((c, i) => {
      if (c.free) {
        grid.append(h("div", { class: "pl-sq pl-free", role: "img", "aria-label": t("play.free_space") },
          logo("pl-free-logo"), h("span", { class: "pl-sq-t" }, t("play.free_2"))));
      } else {
        grid.append(h("button", { class: "pl-sq", type: "button", "data-i": i, "aria-pressed": "false" },
          h("span", { class: "pl-sq-e", "aria-hidden": "true" }, c.e), h("span", { class: "pl-sq-t" }, c.t)));
      }
    });
  }
  const lines = fullLines();
  const inLine = new Set(lines.flatMap(i => LINES[i]));
  const freshSet = new Set(fresh.flatMap(i => LINES[i]));
  [...grid.children].forEach((sq, i) => {
    const on = !!card.on[i];
    if (sq.tagName === "BUTTON") sq.setAttribute("aria-pressed", String(on));
    sq.classList.toggle("on", on);
    sq.classList.toggle("win", inLine.has(i));
    sq.classList.remove("fresh");
    if (freshSet.has(i)) { void sq.offsetWidth; sq.classList.add("fresh"); }
  });
  // meta line: which card, progress
  const n = marked(), bingos = lines.length;
  B.meta.textContent = "";
  B.meta.append(
    h("div", { class: "pl-area" }, h("b", null, AREA_NAME[card.area] || t("play.road_bingo")),
      h("small", null, card.m != null ? t("play.dealt_near_m", { m: mileLabel(card.m) }) : t("play.dealt_before_the_trip"))),
    h("div", { class: "pl-prog" },
      h("span", null, h("b", null, n), "/24"),
      h("span", { class: bingos ? "pl-hot" : "" }, h("b", null, bingos), bingos === 1 ? t("play.bingo") : t("play.bingos"))));
  renderBanner();
}

/** Offer a fresh card when you have driven into a different area than the card was dealt for. */
function renderBanner() {
  if (!B || !card) return;
  const here = hasPos() ? areaAt(S().m) : null;
  const show = !!here && here !== card.area;
  const key = show ? here : "";
  if (B.banner.dataset.key === key) return;
  B.banner.dataset.key = key;
  B.banner.hidden = !show;
  B.banner.textContent = "";
  if (!show) return;
  B.banner.append(h("span", null, t("play.youre_in_x1_now", { x1: AREA_IN[here] || AREA_NAME[here] })),
    h("button", { class: "link", type: "button", onclick: safe(askNewCard, "new card") }, t("play.deal_a_card_for_it")));
}

function closeWin() {
  clearTimeout(winTimer);
  if (winEl) { winEl.remove(); winEl = null; }
}
/** The big moment: a highway-sign BINGO over the screen, confetti, a chime and (if narration is on) one word. */
function celebrate(kind, fresh) {
  closeWin();
  const host = document.getElementById("view-play");
  if (!host) return;
  const full = kind === "full";
  const title = full ? t("play.full_card") : t("play.bingo_2");
  const sub = full ? t("play.every_square_on_the_card") : (fresh.length ? fresh.map(lineName).join(t("play.and")) : t("play.five_in_a_row"));
  const conf = h("div", { class: "pl-confetti", "aria-hidden": "true" });
  const colors = ["accent", "farm", "hist", "nature", "stop", "odd", "ok", "st-wa"];
  for (let i = 0; i < 44; i++) {
    const r = () => Math.random();
    conf.append(h("i", { style: `--x:${(r() * 100).toFixed(1)}%;--dx:${((r() - 0.5) * 40).toFixed(1)}vw;--d:${(r() * 0.6).toFixed(2)}s;` +
      `--t:${(1.7 + r() * 1.3).toFixed(2)}s;--r:${Math.round(r() * 900 - 450)}deg;--c:var(--${colors[i % colors.length]});--w:${6 + Math.round(r() * 6)}px` }));
  }
  winEl = h("div", { class: "pl-win" + (full ? " full" : ""), role: "alert", onclick: closeWin },
    conf,
    h("div", { class: "pl-win-sign" },
      h("div", { class: "pl-win-top" }, logo("pl-win-logo"),
        h("span", null, full ? t("play.road_bingo_2") : t("play.road_bingo_x1", { x1: card.won.length === 1 ? t("play.first_line") : t("play.line_length", { length: card.won.length }) }))),
      h("b", { class: "pl-win-t" }, title),
      h("span", { class: "pl-win-s" }, sub)));
  host.append(winEl);
  winTimer = setTimeout(closeWin, full ? 3600 : 2800);
  unlock();
  chime("success");
  buzz(full ? [60, 50, 60, 50, 160] : [40, 50, 120]);
  if (settings().narr) {
    // After the chime. If the guide is talking it waits its turn, and gives up if that takes more than a few seconds.
    const t0 = Date.now();
    setTimeout(safe(() => gameSay(full ? t("play.full_card_2") : t("play.bingo_3"), "play:bingo", { check: () => Date.now() - t0 < 5000 }), "bingo say"), 600);
  }
}

/* ---------- trivia ---------- */
let T = null;                       // trivia DOM refs
const askedThisSession = new Set(); // question texts already shown this session
let cur = null;                     // {t, id, at, mode, picked, spoken, listening, related, lap}
let tscore = { right: 0, asked: 0, best: 0 };
let streak = 0;

function loadScore() {
  const s = store("trivia", null) || {};
  tscore = { right: Math.max(0, num(s.right)), asked: Math.max(0, num(s.asked)), best: Math.max(0, num(s.best)) };
  if (tscore.right > tscore.asked) tscore.asked = tscore.right;
}
const validQ = t => !!t && typeof t.q === "string" && !!t.q.trim() && Array.isArray(t.choices) &&
  t.choices.length >= 2 && t.choices.length <= LETTERS.length && Number.isInteger(t.answer) && t.answer >= 0 && t.answer < t.choices.length;
const allQs = () => (Array.isArray(D().TRIVIA) ? D().TRIVIA : []).filter(validQ);

const STOP = new Set(("the and that this with from what which when where were was who why how did does into than then about after " +
  "before over under near your they their there here have has had been many much more most some such only also just like made " +
  "make called name named first long high still year years feet miles mile today town city river road").split(" "));
const fold = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function words(s) {
  return new Set((fold(s).match(/[a-z]{4,}/g) || []).filter(w => !STOP.has(w)));
}
/** The landmark a question was written about: nearby, sharing the most words with the question and answer. */
function relatedPlace(t) {
  const P = D().PLACES;
  if (!Array.isArray(P) || !isFinite(t.m)) return null;
  const qw = words(`${t.q} ${t.why || ""} ${t.choices[t.answer] || ""}`);
  let best = null, bestScore = 0;
  for (const p of P) {
    if (!p || !isFinite(p.m) || Math.abs(p.m - t.m) > 4) continue;
    const pw = words(`${p.name} ${p.text || ""} ${p.more || ""}`);
    let s = 0;
    for (const w of qw) if (pw.has(w)) s++;
    for (const w of words(p.name)) if (qw.has(w)) s += 2;
    s -= Math.abs(p.m - t.m) * 0.3;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return bestScore >= 2 ? best : null;
}
const isUrl = u => typeof u === "string" && /^https?:\/\//i.test(u);
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } }
/** A stable id for a question's speech: its index in TRIVIA (or a hash of its text). */
function qid(t) {
  const i = Array.isArray(D().TRIVIA) ? D().TRIVIA.indexOf(t) : -1;
  if (i >= 0) return String(i);
  let x = 0;
  for (const ch of String(t.q)) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return "h" + (x >>> 0).toString(36);
}

/** Next question: closest to you (ahead of you first while driving), never one already asked this session. */
function pickQuestion() {
  const all = allQs();
  if (!all.length) { cur = null; return null; }
  let list = all.filter(t => !askedThisSession.has(t.q));
  let lap = false;
  if (!list.length) { askedThisSession.clear(); list = all.slice(); lap = true; }
  if (cur && list.length > 1) list = list.filter(t => t.q !== cur.t.q);
  let t;
  if (hasPos()) {
    const m = S().m, dir = S().dir;
    const score = q => {
      const qm = num(q.m, NaN);
      if (!isFinite(qm)) return 1e6;
      if (!driving()) return Math.abs(qm - m);
      const d = aheadOf(m, dir, qm);
      return d >= -1 ? Math.max(0, d) : 400 + Math.abs(d);   // behind you only once nothing is left ahead
    };
    t = list.slice().sort((a, b) => score(a) - score(b))[0];
  } else {
    t = list[Math.floor(Math.random() * list.length)];
  }
  askedThisSession.add(t.q);
  cur = { t, id: qid(t), at: hasPos() ? S().m : null, mode: S().mode, picked: null, spoken: false, listening: false, related: relatedPlace(t), lap };
  return cur;
}
/** An unanswered question that belongs somewhere else: picked (or last read aloud) more than 15 miles from here,
    or before we knew where you are; or, if nobody has heard it yet, about a place already 5 miles behind you. */
function stale(c) {
  if (!c || c.picked != null || c.listening || !hasPos()) return false;
  if (c.at == null || Math.abs(S().m - c.at) > 15) return true;
  return !c.spoken && driving() && isFinite(c.t.m) && aheadOf(S().m, S().dir, c.t.m) < -5;
}
/** Swap a stale question for the closest one. The stale one goes back in the pile. True if it changed. */
function freshen() {
  if (!stale(cur)) return false;
  askedThisSession.delete(cur.t.q);
  cur = null;
  pickQuestion();
  return true;
}

const choiceText = c => String(c == null ? "" : c).trim().replace(/[.?!:;,]+$/, "");
function questionSpeech(t) {
  return `${t.q} ${t.choices.map((c, i) => `${LETTERS[i]}: ${choiceText(c)}.`).join(" ")}`;
}
function verdict(ok, t) {
  return ok ? i18n.t("play.thats_right") : i18n.t("play.not_quite_the_answer_is_x1_x2", { x1: LETTERS[t.answer], x2: choiceText(t.choices[t.answer]) });
}
/** Read the question on screen. tap = the passenger pressed the button (say so if it has to wait for the guide). */
function readQuestion(tap = false) {
  const q = cur;
  if (!q) return;
  unlock();
  q.spoken = true;
  if (hasPos()) q.at = S().m;   // heard here: it stays the question for the next 15 miles
  const wait = voiceBusy();
  gameSay(questionSpeech(q.t), "play:trivia:q:" + q.id, { check: () => cur === q && q.picked == null });
  if (wait && tap) toast(t("play.ill_read_it_right_after_this"));
}

function answerTrivia(i, how = "tap") {
  if (!cur || cur.picked != null) return false;
  const q = cur, t = q.t;
  if (!Number.isInteger(i) || i < 0 || i >= t.choices.length) return false;
  q.picked = i;
  q.listening = false;
  const ok = i === t.answer;
  tscore.asked++;
  if (ok) { tscore.right++; streak++; tscore.best = Math.max(tscore.best, streak); } else streak = 0;
  save("trivia", tscore);
  renderTrivia(true);
  if (q.spoken || how === "voice") {
    unlock();
    gameSay(`${verdict(ok, t)} ${t.why || ""}`.trim(), "play:trivia:a:" + q.id, { chime: ok ? "success" : false, check: () => cur === q });
  } else if (ok) {
    chime("success");
  }
  return ok;
}
function nextTrivia() {
  const wasSpoken = !!cur?.spoken;
  pickQuestion();
  renderTrivia();
  if (cur && wasSpoken) readQuestion();
  if (!T) return;
  // the new question is shorter than the answered one: bring its top back into view
  // (12 px under the sticky top bar, which is taller by the safe-area inset on a phone with a notch)
  try {
    const bar = document.querySelector("header.top"), roof = (bar ? bar.getBoundingClientRect().bottom : 60) + 12;
    if (T.box.getBoundingClientRect().top < roof) (T.stats.hidden ? T.box : T.stats).scrollIntoView({ block: "start" });
  } catch { /* old browsers */ }
  const h3 = T.box.querySelector(".pl-qt");
  h3 && h3.focus({ preventScroll: true });
}

/* Answer by voice, when the listen module offers it. Accepts an index, a letter, a number word or the answer text. */
const canListen = () => typeof api?.listen?.listenForAnswer === "function" && api.listen.supported !== false && !api.listen.blocked;
const SAID = [
  ["a", "ay", "eh", "alpha", "first", "one", "1"],
  ["b", "be", "bee", "bravo", "second", "two", "2"],
  ["c", "see", "sea", "si", "charlie", "third", "three", "3"],
  ["d", "dee", "delta", "fourth", "four", "4"],
  ["e", "echo", "fifth", "five", "5"],
  ["f", "foxtrot", "sixth", "six", "6"],
];
function parseAnswer(r, choices) {
  const n = choices.length;
  if (r == null) return null;
  if (typeof r === "number") return Number.isInteger(r) && r >= 0 && r < n ? r : null;
  if (typeof r === "object") {
    for (const k of ["index", "i", "answer", "choice"]) if (typeof r[k] === "number") return parseAnswer(r[k], choices);
    r = r.text ?? r.transcript ?? r.said ?? r.letter ?? "";
  }
  const clean = s => fold(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const s = clean(r);
  if (!s) return null;
  const opts = choices.map(clean);
  const exact = opts.findIndex(o => o && (s === o || ` ${s} `.includes(` ${o} `)));
  if (exact >= 0) return exact;
  const toks = s.split(" ");
  const letterAt = tok => { const i = SAID.findIndex(list => list.includes(tok)); return i >= 0 && i < n ? i : null; };
  if (toks.length <= 4) for (let k = toks.length - 1; k >= 0; k--) { const i = letterAt(toks[k]); if (i != null) return i; }
  const said = new Set(toks.filter(w => w.length >= 3));
  const hits = opts.map(o => o.split(" ").filter(w => w.length >= 3 && said.has(w)).length);
  const top = Math.max(...hits);
  if (top > 0 && hits.filter(x => x === top).length === 1) return hits.indexOf(top);
  for (let k = toks.length - 1; k >= 0; k--) { const i = letterAt(toks[k]); if (i != null) return i; }
  return null;
}
const BLOCKED = t("play.the_microphone_is_blocked_tap_an");
async function voiceAnswer() {
  if (!cur || cur.picked != null || cur.listening) return;
  if (!canListen()) {   // the microphone was refused after this button was drawn
    if (api?.listen?.blocked) toast(BLOCKED);
    renderTrivia();
    return;
  }
  unlock();
  const q = cur;
  q.spoken = true;
  if (hasPos()) q.at = S().m;
  q.listening = true;
  renderTrivia();
  let res = null;
  try {
    res = await Promise.race([
      Promise.resolve(api.listen.listenForAnswer(q.t.choices.slice(), { letters: LETTERS.slice(0, q.t.choices.length), question: q.t.q })),
      new Promise(r => setTimeout(() => r(null), 15000)),
    ]);
  } catch { res = null; }
  if (cur !== q || q.picked != null) return;   // moved on while listening
  q.listening = false;
  const i = parseAnswer(res, q.t.choices);
  if (i == null) {
    renderTrivia();   // hides the voice button if the microphone is blocked now
    if (res == null && api?.listen?.blocked) toast(BLOCKED);
    // null = cancelled or not understood, and the listen module already said so; anything else we couldn't read
    else if (res != null) toast(t("play.i_didnt_catch_that_say_replace_or_tap", { replace: LETTERS.slice(0, q.t.choices.length).join(", ").replace(/, ([^,]*)$/, " or $1") }));
    return;
  }
  answerTrivia(i, "voice");
}

function buildTrivia(pane) {
  const stats = h("div", { class: "pl-stats", "aria-label": t("play.trivia_score") });
  const box = h("div", { class: "pl-q" });
  box.addEventListener("click", safe(e => {
    const b = e.target.closest("button[data-i]");
    if (b && !b.disabled) answerTrivia(+b.dataset.i);
  }, "trivia tap"));
  // Classic (one question at a time, no clock) or the speed round (10 questions on a clock, js/games/speed.js)
  const modes = h("div", { class: "seg wide pl-tmodes", role: "group", "aria-label": t("play.trivia_mode") },
    h("button", { type: "button", "data-tm": "classic", "aria-pressed": "true", onclick: safe(() => setTriviaMode("classic"), "classic") }, t("play.classic")),
    h("button", { type: "button", "data-tm": "speed", "aria-pressed": "false", onclick: safe(() => setTriviaMode("speed"), "speed") }, t("play.speed_round")));
  const speedHost = h("div", { class: "pl-speed", hidden: true });
  pane.append(modes, stats, box, speedHost);
  T = { pane, stats, box, modes, speedHost, mode: "classic", speedCtrl: null, speedLoading: false };
}

function renderTriviaStats() {
  const tile = (n, label, hot) => h("div", { class: "pl-stat" + (hot ? " hot" : "") }, h("b", null, n), h("span", null, label));
  const pct = tscore.asked ? Math.round(tscore.right / tscore.asked * 100) : null;
  T.stats.textContent = "";
  T.stats.append(
    tile(tscore.right, pct == null ? t("play.right_so_far") : t("play.right_pct", { pct })),
    tile(tscore.asked, "answered"),
    tile(streak, tscore.best > streak ? t("play.in_a_row_best_best", { best: tscore.best }) : t("play.in_a_row"), streak >= 3));
}

function renderTrivia(justAnswered = false) {
  if (!T) return;
  renderTriviaStats();
  const box = T.box;
  box.textContent = "";
  if (!cur) pickQuestion();
  T.stats.hidden = T.mode === "speed" || (!cur && !tscore.asked);
  if (!cur) {
    box.classList.add("pl-empty");
    box.append(h("p", { class: "pl-qt" }, i18n.t("play.no_trivia_questions_yet")),
      h("p", { class: "pl-why" }, i18n.t("play.questions_about_the_road_show_up_here")));
    return;
  }
  box.classList.remove("pl-empty");
  const t = cur.t, answered = cur.picked != null;
  // where the question is from
  let dist = "";
  if (isFinite(t.m)) {
    if (hasPos()) {
      const d = aheadOf(S().m, S().dir, t.m);
      dist = Math.abs(d) < 1 ? i18n.t("play.right_around_here") : d > 0 ? i18n.t("play.d_mi_ahead", { d: Math.round(d) }) : i18n.t("play.x1_mi_back", { x1: Math.round(-d) });
    } else dist = mileLabel(t.m);
  }
  const rn = isFinite(t.m) ? regionName(t.m) : "";
  box.append(h("div", { class: "pl-qmeta" },
    h("span", null, i18n.t("play.question_size_of_length", { size: askedThisSession.size, length: allQs().length })),
    h("span", { class: "pl-qwhere" }, [rn, dist].filter(Boolean).join(" · "))));
  if (cur.lap && !answered) box.append(h("p", { class: "pl-note" }, i18n.t("play.youve_seen_every_question_this_trip")));
  box.append(h("h3", { class: "pl-qt", tabindex: "-1" }, t.q));
  const opts = h("div", { class: "pl-opts", role: "group", "aria-label": i18n.t("play.answers") });
  t.choices.forEach((c, i) => {
    let state = "";
    if (answered) state = i === t.answer ? "right" : i === cur.picked ? "wrong" : "dim";
    const label = `${LETTERS[i]}. ${choiceText(c)}` + (state === "right" ? i18n.t("play.correct_answer") : state === "wrong" ? i18n.t("play.your_answer_wrong") : "");
    opts.append(h("button", { class: `pl-opt ${state}`, type: "button", "data-i": i, disabled: answered, "aria-label": label },
      h("span", { class: "pl-let", "aria-hidden": "true" }, LETTERS[i]),
      h("span", { class: "pl-opt-t", "aria-hidden": "true" }, choiceText(c)),
      state === "right" ? icon("check", "pl-ic pl-mark") : state === "wrong" ? icon("cross", "pl-ic pl-mark") : null));
  });
  box.append(opts);
  if (!answered) {
    const tools = h("div", { class: "pl-tools" },
      canSpeak() ? h("button", { class: "secondary pl-tool", type: "button", onclick: safe(() => readQuestion(true), "read") }, icon("speaker"), i18n.t("play.read_it_out_loud")) : null);
    if (canListen()) {
      tools.append(h("button", { class: "secondary pl-tool" + (cur.listening ? " pl-listening" : ""), type: "button", disabled: cur.listening,
        onclick: safe(voiceAnswer, "voice answer") }, icon("mic"), cur.listening ? i18n.t("play.listening") : i18n.t("play.answer_by_voice")));
    }
    tools.append(h("button", { class: "link pl-skip", type: "button", onclick: safe(nextTrivia, "skip") }, i18n.t("play.skip")));
    box.append(tools);
    return;
  }
  const ok = cur.picked === t.answer;
  const fb = h("div", { class: "pl-fb " + (ok ? "ok" : "no"), role: "status" },
    h("div", { class: "pl-verdict", tabindex: "-1" }, icon(ok ? "check" : "cross", "pl-ic pl-vic"),
      h("b", null, ok ? (streak >= 3 ? i18n.t("play.thats_right_streak_in_a_row", { streak }) : i18n.t("play.thats_right")) : i18n.t("play.not_quite"))),
    ok ? null : h("p", { class: "pl-ans" }, i18n.t("play.the_answer_is_x1_x2", { x1: LETTERS[t.answer], x2: choiceText(t.choices[t.answer]) })),
    t.why ? h("p", { class: "pl-why" }, t.why) : null);
  const src = isUrl(t.src) ? t.src : isUrl(cur.related?.src) ? cur.related.src : null;
  const links = h("p", { class: "pl-src" });
  if (src) links.append(h("span", null, i18n.t("play.source"), h("a", { href: src, target: "_blank", rel: "noopener" }, hostOf(src))));
  if (cur.related) {
    const p = cur.related;
    links.append(h("button", { class: "link", type: "button", onclick: () => openPlace(p) }, i18n.t("play.about_name", { name: p.name })));
  }
  if (links.childNodes.length) fb.append(links);
  fb.append(h("button", { class: "primary pl-next", type: "button", onclick: safe(nextTrivia, "next") }, i18n.t("play.next_question"), icon("next")));
  box.append(fb);
  if (justAnswered) {
    const v = fb.querySelector(".pl-verdict");
    v && v.focus({ preventScroll: true });
    // bring the answer and the Next button into view (scroll-margin keeps them clear of the header and tab bar)
    try { fb.querySelector(".pl-next").scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }
  }
}

/** For voice commands and other modules: go to Play, open Trivia and read the next question aloud. */
function askTrivia() {
  try { api?.ui?.go?.("play"); } catch (e) { console.error("[play] go", e); }
  setGame("trivia");
  if (T && T.mode === "speed") setTriviaMode("classic");   // a spoken "ask me trivia" means the one-question kind
  freshen();   // a question picked miles ago, or before GPS, gives way to the closest one
  if (!cur || cur.picked != null) pickQuestion();
  renderTrivia();
  if (cur) { readQuestion(); return true; }
  unlock();
  gameSay(t("play.i_dont_have_any_trivia_questions_yet"), "play:trivia:none");
  return false;
}

/* ---------- I spy ----------
   A card shows whenever the guide announces or speaks a landmark's I spy challenge (Kid mode), and, while driving,
   for every I spy landmark coming into view that the guide stays quiet about (narration off, or a category it
   skips). Several can be up at once: the one being spoken sits on top in full, earlier ones below in a compact
   form, each with its own buttons. A place pays 10 points once per trip, every trip. */
let spy = { points: 0, found: [], missed: [] };
let spots = [];               // cards on screen, top first: {p, state: "ask" | "found" | "missed", pts, timer}
const MAX_SPOTS = 3;
const trip = { shown: new Set(), answered: new Set(), scored: new Set() };   // place ids, this trip only
let movedAt = 0;              // when the cards last moved under someone's finger
let spotWrap = null;          // the cards' box inside #spotCard
let SP = null;                // I spy pane refs
let quick = null;             // {e, t, state, n}
let quickN = 0;
const quickRecent = [];

function loadSpy() {
  const s = store("spy", null) || {};
  const ids = a => (Array.isArray(a) ? [...new Set(a.filter(x => typeof x === "string"))] : []);
  spy = { points: Math.max(0, num(s.points)), found: ids(s.found), missed: ids(s.missed) };
  spy.missed = spy.missed.filter(id => !spy.found.includes(id));
}
const saveSpy = () => save("spy", spy);
const isSpot = p => !!p && typeof p.id === "string" && !!p.id && typeof p.spot === "string" && !!p.spot.trim() && !!p.vis;
/** Miles you've driven past a place (negative = still ahead). */
const behind = p => (hasPos() && isFinite(p.m) ? -aheadOf(S().m, S().dir, p.m) : 0);
function fmtMi(d) {
  try { if (D().fmtMiles && d >= 0.3) return D().fmtMiles(d); } catch { /* below */ }
  return d < 10 ? d.toFixed(1) : String(Math.round(d));
}
function spotWhere(p) {
  if (!hasPos() || !isFinite(p.m)) return "";
  const d = aheadOf(S().m, S().dir, p.m);
  const side = sideOf(p);
  const dist = d >= 0.3 ? t("play.d_mi", { d: fmtMi(d) }) : d > -0.3 ? t("play.now") : t("play.just_passed");
  return [dist, side && (side === "left" ? t("play.left") : t("play.right"))].filter(Boolean).join(" · ");
}

/** Put a card up for p (on top). Already up: nothing to do. */
function showSpot(p) {
  if (!settings().kid || !isSpot(p) || spots.some(s => s.p.id === p.id) || behind(p) > 1) return false;
  trip.shown.add(p.id);
  spots.unshift({ p, state: "ask", pts: 0, timer: 0 });
  while (spots.length > MAX_SPOTS) {   // too many: let the oldest go, answered ones first
    let k = spots.length - 1;
    for (let i = spots.length - 1; i > 0; i--) if (spots[i].state !== "ask") { k = i; break; }
    clearTimeout(spots[k].timer);
    spots.splice(k, 1);
  }
  renderSpots();
  const side = sideOf(p);
  announce(t("play.i_spy_x1_spot", { x1: side ? t("play.on_your_side", { side: D().sideSaid ? D().sideSaid(side) : side }) : "", spot: p.spot }));
  return true;
}
/** The guide queued a landmark announcement (narrator.js adds the challenge to it in Kid mode). */
function onAnnounce(e) {
  if (e && e.place) showSpot(e.place);
}
/** Speech started. A challenge being read (the guide, a Play button, a voice command, a replay) gets its card on
    top, so the big card always matches what you hear. */
function onSpeaking(s) {
  if (!s || typeof s.id !== "string" || ours(s.id) || !settings().kid) return;
  const p = placeById(s.id);
  if (!isSpot(p) || !String(s.text || "").includes(p.spot)) return;
  const k = spots.findIndex(x => x.p.id === p.id);
  if (k > 0) { spots.unshift(spots.splice(k, 1)[0]); renderSpots(); }
  else if (k < 0 && !trip.answered.has(p.id)) showSpot(p);
}
/** While driving, find I spy landmarks coming into view ourselves: the guide stays quiet when narration is off,
    and about categories you turned off. Same heads-up distance as the guide. */
function scanSpots(e) {
  if (!settings().kid || !driving() || !hasPos() || S().offRoute) return;
  const P = D().PLACES;
  if (!Array.isArray(P) || !P.length) return;
  const m = S().m, dir = S().dir;
  const lead = Math.max(num(settings().lead, 2), num(S().speed) * 75 / 3600) + 0.01;
  const min = e && e.jumped ? 0 : -0.3;
  const due = [];
  for (const p of P) {
    if (!isSpot(p) || !isFinite(p.m) || trip.shown.has(p.id)) continue;
    const d = aheadOf(m, dir, p.m);
    if (d > min && d < lead) due.push({ p, d });
  }
  due.sort((a, b) => b.d - a.d);   // farthest first, so the nearest ends up on top
  for (const x of due) showSpot(x.p);
}
function removeSpot(id) {
  const k = spots.findIndex(s => s.p.id === id);
  if (k < 0) return;
  clearTimeout(spots[k].timer);
  spots.splice(k, 1);
  renderSpots();
}
function clearSpots() {
  if (!spots.length) return;
  for (const s of spots) clearTimeout(s.timer);
  spots = [];
  renderSpots();
}
function endTrip() {
  clearSpots();
  trip.shown.clear(); trip.answered.clear(); trip.scored.clear();
}
function onSpotPos(e) {
  scanSpots(e);
  if (!spots.length) return;
  // drove past it, or jumped far away from it
  const gone = s => s.state === "ask" && (behind(s.p) > 1 || (!!e?.jumped && behind(s.p) < -15));
  if (spots.some(gone)) {
    spots = spots.filter(s => { if (gone(s)) { clearTimeout(s.timer); return false; } return true; });
    renderSpots();
  } else updateSpotDistances();
}
function answerSpot(id, found) {
  const s = spots.find(x => x.p.id === id);
  if (!s || s.state !== "ask") return;
  const p = s.p;
  unlock();
  trip.answered.add(p.id);
  if (found) {
    if (!trip.scored.has(p.id)) { trip.scored.add(p.id); spy.points += 10; s.pts = 10; }
    if (!spy.found.includes(p.id)) spy.found.push(p.id);
    spy.missed = spy.missed.filter(x => x !== p.id);
    chime("success");
    buzz([30, 40, 60]);
  } else if (!spy.found.includes(p.id) && !spy.missed.includes(p.id)) {
    spy.missed.push(p.id);
  }
  saveSpy();
  s.state = found ? "found" : "missed";
  renderSpots();
  renderSpy();
  announce(found ? (s.pts ? t("play.found_it_plus_pts_points_points", { pts: s.pts, points: spy.points }) : t("play.found_it_again_points_points", { points: spy.points })) : t("play.missed_it_next_time"));
  clearTimeout(s.timer);
  s.timer = setTimeout(safe(() => removeSpot(p.id), "spot done"), found ? 2200 : 1300);
}

function spotCardEl(s, main) {
  const p = s.p, st = s.state;
  const name = String(p.name || t("play.this_place"));
  // A tap that lands within a moment of the cards moving was aimed at something else (keyboard clicks have detail 0).
  const act = found => e => { if (e && e.detail > 0 && Date.now() - movedAt < 450) return; answerSpot(p.id, found); };
  const body = st === "ask"
    ? h("div", { class: "pl-spot-acts" },
      h("button", { class: "pl-found", type: "button", "aria-label": t("play.found_it_name", { name }), onclick: safe(act(true), "found") }, icon("check"), t("play.found_it")),
      h("button", { class: "pl-missed", type: "button", "aria-label": t("play.missed_it_name", { name }), onclick: safe(act(false), "missed") }, t("play.missed_it")))
    : h("div", { class: "pl-spot-done", tabindex: "-1" }, st === "found"
      ? [s.pts ? h("b", { class: "pl-plus" }, `+${s.pts}`) : icon("check", "pl-ic pl-again"),
        h("span", null, s.pts ? t("play.nice_spotting_points_points", { points: spy.points }) : t("play.found_again_points_points", { points: spy.points }))]
      : h("span", null, t("play.next_time_keep_your_eyes_peeled")));
  return h("section", { class: `pl-spot${main ? "" : " pl-mini"} ${p.cat || ""} ${st}`, "aria-label": t("play.i_spy_name", { name }), "data-id": p.id },
    main ? h("div", { class: "pl-spot-eye" }, icon("eye", "pl-eye")) : null,
    h("div", { class: "pl-spot-body" },
      h("div", { class: "pl-spot-k" }, h("span", null, t("play.i_spy")), h("span", { class: "pl-spot-d", "aria-hidden": "true" }, spotWhere(p))),
      h("p", { class: "pl-spot-q" }, p.spot),
      main ? h("button", { class: "pl-spot-name", type: "button", onclick: () => openPlace(p) }, name) : null),
    body);
}
/** Make a host's cards match `spots`, reusing the ones that didn't change (keeps focus and skips the animation). */
function syncSpots(host) {
  const old = new Map();
  for (const el of host.querySelectorAll(":scope > .pl-spot")) old.set(el.dataset.key, el);
  const had = new Set([...old.values()].map(el => el.dataset.id));
  const want = spots.map((s, i) => {
    const key = `${s.p.id}|${s.state}|${i ? "mini" : "main"}`;
    let el = old.get(key);
    if (el) old.delete(key);
    else {
      el = spotCardEl(s, i === 0);
      el.dataset.key = key;
      if (had.has(s.p.id)) el.classList.add("pl-still");   // the same card in a new form: no entrance
    }
    return el;
  });
  for (const el of old.values()) el.remove();
  let ref = null;
  for (let k = want.length - 1; k >= 0; k--) {
    const el = want[k];
    if (el.parentNode !== host || el.nextElementSibling !== ref) host.insertBefore(el, ref);
    ref = el;
  }
  host.hidden = !spots.length;
}
function spotHosts() { return [spotWrap, SP?.live].filter(Boolean); }
let spotOrder = "";
function renderSpots() {
  const hosts = spotHosts();
  const a = document.activeElement;
  const inCard = a && a.closest ? a.closest(".pl-spot") : null;
  const host = inCard ? hosts.find(x => x.contains(inCard)) : null;
  const id = inCard ? inCard.dataset.id : null;
  for (const x of hosts) syncSpots(x);
  // cards came, went or swapped places: buttons moved (an answer keeps its card the same height, so it doesn't count)
  const order = spots.map(s => s.p.id).join("|");
  if (order !== spotOrder) { spotOrder = order; movedAt = Date.now(); }
  updateSpotDistances();
  // the focused card was redrawn (answered) or went away: keep keyboard focus on this card, or the next one
  if (host && !host.contains(document.activeElement)) {
    const cards = [...host.querySelectorAll(":scope > .pl-spot")];
    const el = cards.find(c => c.dataset.id === id) || cards[0];
    const target = el && (el.querySelector(".pl-spot-done") || el.querySelector("button"));
    if (target) target.focus({ preventScroll: true });
  }
}
function updateSpotDistances() {
  for (const host of spotHosts()) {
    for (const el of host.querySelectorAll(":scope > .pl-spot")) {
      const s = spots.find(x => x.p.id === el.dataset.id);
      const d = el.querySelector(".pl-spot-d");
      if (!s || !d) continue;
      const t = spotWhere(s.p);
      if (d.textContent !== t) d.textContent = t;   // only when it changes: it updates on every GPS fix
    }
  }
}

/* Quick challenge: a classic "I spy" pulled from the bingo squares for where you are. Works with no data at all. */
function dealQuick() {
  const area = hasPos() ? areaAt(S().m) : null;
  const season = seasonNow();
  const fits = sq => !sq.when || !season || sq.when.includes(season);
  const from = [...(area ? POOLS[area] : []), ...POOLS.general, ...(area ? [] : areas().flatMap(a => POOLS[a]))]
    .map(parseSquare).filter(sq => fits(sq) && !quickRecent.includes(sq.t));
  const sq = from[Math.floor(Math.random() * from.length)] || parseSquare(POOLS.general[0]);
  quickRecent.push(sq.t);
  if (quickRecent.length > 12) quickRecent.shift();
  quick = { e: sq.e, t: sq.t, state: "ask", n: ++quickN };
}
function quickFound() {
  if (!quick || quick.state !== "ask") return;
  unlock();
  spy.points += 5;
  saveSpy();
  chime("success");
  buzz(30);
  quick.state = "found";
  renderSpy();
  announce(t("play.got_it_plus_5_points_points", { points: spy.points }));
  const q = quick;
  setTimeout(safe(() => { if (quick === q) { dealQuick(); renderSpy(); } }, "quick"), 1600);
}
function sayQuick() {
  const q = quick;
  if (!q) return;
  unlock();
  const wait = voiceBusy();
  gameSay(t("play.i_spy_with_my_little_eye_replace", { replace: q.t.replace(/\u00AD/g, "").toLowerCase() }), "play:spy:quick:" + q.n,
    { check: () => quick === q && q.state === "ask" });
  if (wait) toast(t("play.ill_say_it_right_after_this"));
}
function turnOnKid() {
  const s = settings();
  s.kid = true;
  try { api?.saveSettings?.(); } catch (e) { console.error("[play] saveSettings", e); }
  toast(t("play.kid_mode_is_on_i_spy_challenges_will"));
  renderSpy();
}

function buildSpy(pane) {
  SP = {
    pane,
    hint: h("div", { class: "pl-hint" }),
    hero: h("div", { class: "pl-spy-hero" }),
    live: h("div", { class: "pl-spots", hidden: true }),
    quick: h("div", { class: "pl-quick" }),
    list: h("div", { class: "pl-finds" }),
  };
  pane.append(SP.hint, SP.hero, SP.live, SP.quick, SP.list);
}
function renderSpy() {
  if (!SP) return;
  const kid = !!settings().kid;
  SP.hint.hidden = kid;
  SP.hint.textContent = "";
  if (!kid) {
    SP.hint.append(h("div", { class: "pl-hint-eye" }, icon("eye", "pl-eye")),
      h("div", { class: "pl-hint-tx" }, h("b", null, t("play.i_spy_needs_kid_mode")),
        h("p", null, t("play.with_kid_mode_on_ill_point_out_things"))),
      h("button", { class: "primary", type: "button", onclick: safe(turnOnKid, "kid mode") }, t("play.turn_on_kid_mode")));
  }
  // points (finds and misses count places on this road: one saved when the app covered Oregon isn't listed, so it isn't counted)
  const found = spy.found.map(placeById).filter(Boolean).reverse();
  SP.hero.textContent = "";
  SP.hero.append(h("div", { class: "pl-hero-eye" }, icon("eye", "pl-eye")),
    h("div", { class: "pl-hero-n" }, h("b", null, spy.points.toLocaleString(loc(undefined))), h("span", null, spy.points === 1 ? t("play.point") : t("play.points"))),
    h("div", { class: "pl-hero-c" },
      h("span", null, h("b", null, found.length), t("play.found")),
      h("span", null, h("b", null, spy.missed.filter(placeById).length), t("play.missed"))));
  // quick challenge
  if (!quick) dealQuick();
  SP.quick.textContent = "";
  const done = quick.state === "found";
  SP.quick.className = "pl-quick" + (done ? " found" : "");
  SP.quick.append(
    h("div", { class: "pl-quick-k" }, h("span", null, t("play.quick_challenge")), h("span", { class: "pl-quick-pts" }, "+5")),
    h("div", { class: "pl-quick-main" },
      h("span", { class: "pl-quick-e", "aria-hidden": "true" }, quick.e),
      h("div", null, h("small", null, t("play.i_spy_with_my_little_eye")), h("b", null, quick.t))),
    done
      ? h("div", { class: "pl-spot-done" }, h("b", { class: "pl-plus" }, "+5"), h("span", null, t("play.got_it_here_comes_another_one")))
      : h("div", { class: "pl-row" },
        h("button", { class: "pl-found", type: "button", onclick: safe(quickFound, "quick found") }, icon("check"), t("play.found_it")),
        canSpeak() ? h("button", { class: "secondary pl-icon-btn", type: "button", "aria-label": t("play.say_it_out_loud"), onclick: safe(sayQuick, "say quick") }, icon("speaker")) : null,
        h("button", { class: "secondary", type: "button", onclick: safe(() => { dealQuick(); renderSpy(); }, "quick new") }, t("play.new_one"))));
  // found places
  SP.list.textContent = "";
  SP.list.append(h("h3", { class: "sub" }, found.length ? t("play.found_on_the_road_length", { length: found.length }) : t("play.found_on_the_road")));
  if (!found.length) {
    const any = (Array.isArray(D().PLACES) ? D().PLACES : []).some(isSpot);
    SP.list.append(h("p", { class: "pl-none" }, any
      ? t("play.nothing_yet_when_i_spy_something_along")
      : t("play.landmark_i_spy_challenges_are_on_their")));
    return;
  }
  const ul = h("ul", { class: "pl-flist" });
  for (const p of found) {
    ul.append(h("li", null, h("button", { class: `pl-fitem ${p.cat || ""}`, type: "button", onclick: () => openPlace(p) },
      h("span", { class: "pl-fdot", "aria-hidden": "true" }),
      h("span", { class: "pl-ftx" }, h("b", null, p.name), h("small", null, [p.spot, mileLabel(p.m)].filter(Boolean).join(" · "))),
      icon("next", "pl-ic pl-chev"))));
  }
  SP.list.append(ul);
}

/* ---------- speech for the new games ----------
   A line the person asked for (a speaker button) goes through gameSay and always plays. A reaction or a celebration that
   nobody asked for goes through autoSay: only with narration on, and never while the car is navigating (api.nav). */
const navigating = () => { try { return api?.nav?.state?.() === "navigating"; } catch { return false; } };
const autoOk = () => !!settings().narr && canSpeak() && !navigating();
function autoSay(text, id, extra) { return autoOk() ? gameSay(text, id, extra) : Promise.resolve(false); }

/* ---------- a celebration for the new games (the bingo sign and confetti, with their own words) ---------- */
function confettiEl(n = 44) {
  const conf = h("div", { class: "pl-confetti", "aria-hidden": "true" });
  const colors = ["accent", "farm", "hist", "nature", "stop", "odd", "ok", "st-wa"];
  for (let i = 0; i < n; i++) {
    const r = () => Math.random();
    conf.append(h("i", { style: `--x:${(r() * 100).toFixed(1)}%;--dx:${((r() - 0.5) * 40).toFixed(1)}vw;--d:${(r() * 0.6).toFixed(2)}s;` +
      `--t:${(1.7 + r() * 1.3).toFixed(2)}s;--r:${Math.round(r() * 900 - 450)}deg;--c:var(--${colors[i % colors.length]});--w:${6 + Math.round(r() * 6)}px` }));
  }
  return conf;
}
/** o: {top: small line above, title: big words, sub: one line under, ms, speak: [text, id]}. Real celebrations only. */
function cheer(o = {}) {
  closeWin();
  const host = document.getElementById("view-play");
  if (!host) return null;
  const title = String(o.title || "");
  const size = title.length <= 7 ? "" : title.length <= 10 ? " full" : " small";
  winEl = h("div", { class: "pl-win" + size, role: "alert", onclick: closeWin },
    confettiEl(o.pieces || 44),
    h("div", { class: "pl-win-sign" },
      h("div", { class: "pl-win-top" }, logo("pl-win-logo"), h("span", null, o.top || t("play.i_5_buddy"))),
      h("b", { class: "pl-win-t" }, title),
      o.sub ? h("span", { class: "pl-win-s" }, o.sub) : null));
  host.append(winEl);
  winTimer = setTimeout(closeWin, o.ms || 3200);
  unlock();
  chime("success");
  buzz([40, 50, 120]);
  if (o.speak) { const t0 = Date.now(); setTimeout(safe(() => autoSay(o.speak[0], o.speak[1], { check: () => Date.now() - t0 < 5000 }), "cheer say"), 600); }
  return winEl;
}

/** A place photo with its credit, built like the app's own (main.js photo()). The alt text is the caller's: a quiz must not
    name the place before the answer. A photo that will not load calls o.onError (default: it goes away). */
function gamePhoto(p, o = {}) {
  if (!p || !p.img || !p.img.f) return null;
  const size = o.size || "full";
  const fig = h("figure", { class: "photo " + size });
  const img = h("img", { src: p.img.f, alt: o.alt != null ? o.alt : (p.img.alt_en || p.img.alt || p.name || ""), decoding: "async" });
  if (p.img.w && p.img.h) { img.width = p.img.w; img.height = p.img.h; }
  img.addEventListener("error", () => { if (o.onError) o.onError(); else fig.remove(); });
  fig.append(img);
  if (size !== "thumb") {
    fig.append(h("figcaption", null, h("a", { href: p.img.url || "https://commons.wikimedia.org", target: "_blank", rel: "noopener" },
      t("play.photo_x1_x2", { x1: p.img.by || t("play.wikimedia_commons"), x2: p.img.lic ? " · " + p.img.lic : "" }))));
  }
  return fig;
}

/* ---------- every sentence the games can say (for the natural recorded voice) ---------- */
const PLACE_IMG = () => (Array.isArray(D().PLACES) ? D().PLACES : []).filter(p => p && p.img && p.img.f && typeof p.text === "string" && p.text.trim());
function phraseGroups() {
  const g = {};
  const put = (k, t) => { const s = String(t == null ? "" : t).replace(/\s+/g, " ").trim(); if (s) (g[k] = g[k] || new Set()).add(s); };
  put("bingo", i18n.t("play.bingo_3")); put("bingo", i18n.t("play.full_card_2"));
  put("trivia", i18n.t("play.i_dont_have_any_trivia_questions_yet"));
  for (const t of allQs()) {
    put("trivia", questionSpeech(t));
    put("trivia", `${verdict(true, t)} ${t.why || ""}`);
    put("trivia", `${verdict(false, t)} ${t.why || ""}`);
  }
  for (const pool of Object.values(POOLS)) for (const sq of pool) put("spy", i18n.t("play.i_spy_with_my_little_eye_replace", { replace: parseSquare(sq).t.replace(/­/g, "").toLowerCase() }));
  put("plates", WORDS.plates.all); for (const t of Object.values(WORDS.plates.rare)) put("plates", t);
  put("higher", WORDS.hol.right); put("higher", WORDS.hol.wrong); put("higher", WORDS.hol.best);
  put("where", WORDS.where.good); put("where", WORDS.where.miss); put("where", WORDS.where.round);
  for (const p of PLACE_IMG()) put("where", firstSentence(p.text));
  for (const p of WYR) put("wyr", wyrSpeech(p));
  put("hunt", WORDS.hunt.done);
  for (const l of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") put("alpha", alphaSpeech(l));
  for (const t of Object.values(ALPHA_TIPS)) put("alpha", t);
  put("alpha", WORDS.alpha.done);
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, [...v]]));
}
/** Every fixed sentence the games can speak, once each. */
function phrases() {
  return [...new Set(Object.values(phraseGroups()).flat())];
}

/* ---------- the Play view: a picker of game cards, then the game ---------- */
const GAME_DEFS = [
  { id: "bingo", name: t("play.road_bingo"), line: t("play.five_in_a_row_wins"), emoji: "\u{1F3AF}", color: "--accent", core: true },
  { id: "trivia", name: t("play.trivia"), line: t("play.questions_about_the_road_or_race_the"), emoji: "\u{1F914}", color: "--shield", core: true },
  { id: "spy", name: t("play.i_spy"), line: t("play.spot_things_as_you_pass_them"), emoji: "\u{1F440}", color: "--odd", core: true },
  { id: "plates", name: t("play.plate_hunt"), line: t("play.find_a_plate_from_every_state"), emoji: "\u{1F5FA}️", color: "--nature", file: "plates" },
  { id: "higher", name: t("play.higher_or_lower"), line: t("play.guess_the_number_keep_the_streak"), emoji: "\u{1F4C8}", color: "--ok", file: "higher" },
  { id: "where", name: t("play.where_is_this"), line: t("play.name_the_place_from_its_photo"), emoji: "\u{1F4F8}", color: "--hist", file: "where" },
  { id: "wyr", name: t("play.would_you_rather"), line: t("play.road_trip_questions_no_wrong_answers"), emoji: "\u{1F937}", color: "--stop", file: "wyr" },
  { id: "hunt", name: t("play.scavenger_hunt"), line: t("play.spot_what_this_stretch_of_road_has"), emoji: "\u{1F50D}", color: "--farm", file: "hunt" },
  { id: "alpha", name: t("play.alphabet_game"), line: t("play.find_signs_from_a_to_z"), emoji: "\u{1F524}", color: "--danger", file: "alpha" },
  { id: "cows", name: t("play.cow_count"), line: t("play.each_side_of_the_car_counts_cows"), emoji: "\u{1F404}", color: "--town", file: "cows" },
];
const defOf = id => GAME_DEFS.find(g => g.id === id) || null;
let V = null;
let game = "bingo";          // the last game opened (saved as "playGame")
let screen = "home";         // what the Play tab shows now: "home" (the picker), "party", or a game id
let lastTab = null;
let party = null;            // the Car Party scoreboard (js/games/party.js)
const mods = {};             // game id -> {state, promise, ctrl}
const viewVisible = () => { const v = document.getElementById("view-play"); return !!v && !v.hidden; };

/** One line on a game card from what the person saved before (read straight from the store: the game's code may not be loaded). */
function statusOf(id) {
  try {
    const o = key => { const v = store(key, null); return v && typeof v === "object" ? v : {}; };
    if (id === "bingo") return card ? t("play.marked_of_24_marked", { marked: marked() }) : "";
    if (id === "trivia") return tscore.asked ? t("play.right_right", { right: tscore.right }) : "";
    if (id === "spy") return spy.points ? `${spy.points} ${spy.points === 1 ? t("play.point") : t("play.points")}` : "";
    if (id === "plates") { const f = o("plates").found || {}; const n = Object.keys(f).filter(k => /^[A-Z]{2}$/.test(k) && Array.isArray(f[k]) && f[k].length).length; return n ? t("play.n_of_51_found", { n: Math.min(n, 51) }) : ""; }
    if (id === "higher") { const b = num(o("higher").best); return b ? t("play.best_streak_b", { b }) : ""; }
    if (id === "where") { const b = num(o("where").best); return b ? t("play.best_b_of_10", { b }) : ""; }
    if (id === "wyr") { const n = num(o("wyr").n); return n ? t("play.n_answered", { n }) : ""; }
    if (id === "hunt") { const n = Object.keys(o("hunt").stamps || {}).length; return n ? `${n} ${n === 1 ? t("play.stamp") : t("play.stamps")}` : ""; }
    if (id === "alpha") { const b = num(o("alpha").best); return b ? t("play.best_x1_padstart", { x1: Math.floor(b / 60), padStart: String(Math.round(b % 60)).padStart(2, "0") }) : ""; }
    if (id === "cows") { const b = num(o("cows").best); return b ? t("play.best_count_b", { b }) : ""; }
  } catch { /* no status */ }
  return "";
}

function renderHome() {
  if (!V) return;
  const home = V.home;
  const last = defOf(store("playGame", null));
  const had = home.contains(document.activeElement) ? document.activeElement.getAttribute("data-g") || document.activeElement.getAttribute("data-k") : null;
  home.textContent = "";
  // the Car Party bar: scores while a party is on, an invitation while not
  const on = !!party && party.active();
  const bar = h("div", { class: "pl-partybar" + (on ? " on" : "") },
    h("span", { class: "pl-partybar-ic", "aria-hidden": "true" }, "\u{1F389}"),
    h("div", { class: "pl-partybar-tx" },
      h("b", null, t("play.car_party")),
      on ? party.strip() : h("small", null, t("play.keep_score_for_2_to_6_players_the"))),
    h("button", { class: "secondary pl-partybar-go", type: "button", "data-k": "party", onclick: safe(() => showScreen("party"), "party") }, on ? t("play.scores") : t("play.set_up")));
  const grid = h("div", { class: "pl-gridpick", role: "group", "aria-label": t("play.choose_a_game") });
  GAME_DEFS.forEach((d, i) => {
    const st = statusOf(d.id);
    const isLast = !!last && last.id === d.id;
    grid.append(h("button", { class: "pl-gcard" + (isLast ? " last" : ""), type: "button", "data-g": d.id, style: `--c:var(${d.color});--i:${i}`,
      "aria-label": `${d.name}. ${d.line}.${st ? " " + st + "." : ""}${isLast ? t("play.last_played") : ""}`,
      onclick: safe(() => setGame(d.id), "pick " + d.id) },
      isLast ? h("span", { class: "pl-gcard-last", "aria-hidden": "true" }, t("play.last_played_2")) : null,
      h("span", { class: "pl-gcard-ic", "aria-hidden": "true" }, d.emoji),
      h("span", { class: "pl-gcard-t", "aria-hidden": "true" }, h("b", null, d.name), h("small", null, d.line)),
      st ? h("span", { class: "pl-gcard-s", "aria-hidden": "true" }, st) : null));
  });
  home.append(bar, grid);
  if (had) { const b = home.querySelector(`[data-g="${had}"],[data-k="${had}"]`); b && b.focus({ preventScroll: true }); }
}

/** The bar at the top of a game: the way back to the picker, and the game's name. */
function paneBar(d) {
  return h("div", { class: "pl-bar", style: d.color ? `--c:var(${d.color})` : "" },
    h("button", { class: "pl-back", type: "button", "data-k": "back", "aria-label": t("play.back_to_all_games"), onclick: safe(() => showScreen("home"), "back") }, icon("back"), h("span", null, t("play.all_games"))),
    h("b", { class: "pl-bar-t" }, d.emoji ? h("span", { class: "pl-bar-e", "aria-hidden": "true" }, d.emoji) : null, d.name));
}

function renderPassenger() {
  if (!V || !V.pass) return;
  V.pass.hidden = !((S().mode === "gps" || S().mode === "demo") && num(S().speed) > 10);
}

function buildView() {
  const view = document.getElementById("view-play");
  if (!view) return;
  view.textContent = "";
  view.classList.add("pl-view");
  const panes = {}, bodies = {};
  for (const d of GAME_DEFS) {
    panes[d.id] = h("section", { class: "pl-pane", id: "pl-" + d.id, "aria-label": d.name, hidden: true, style: `--c:var(${d.color})` }, paneBar(d));
    if (!d.core) { bodies[d.id] = h("div", { class: "pl-gbody" }); panes[d.id].append(bodies[d.id]); }
  }
  const partyPane = h("section", { class: "pl-pane", id: "pl-party", "aria-label": t("play.car_party"), hidden: true },
    paneBar({ name: t("play.car_party"), emoji: "\u{1F389}", color: "--accent" }));
  const home = h("div", { class: "pl-home", id: "pl-home" });
  sr.view = h("p", { class: "pl-sr", role: "status" });
  const pass = h("p", { class: "pl-pass", role: "note", hidden: true }, icon("info"), h("span", null, t("play.for_passengers_the_driver_keeps_eyes")));
  view.append(h("div", { class: "pl-head" }, h("h2", { class: "view-title" }, t("play.play")), h("p", { class: "pl-lede" }, t("play.games_for_everyone_but_the_driver")), pass),
    home, ...GAME_DEFS.map(d => panes[d.id]), partyPane, sr.view);
  V = { view, home, panes, bodies, partyPane, pass };
  buildBingo(panes.bingo);
  buildTrivia(panes.trivia);
  buildSpy(panes.spy);
  const g = store("playGame", null);
  game = defOf(g) ? g : "bingo";
  showScreen("home", { quiet: true });
  renderPassenger();
}
/** #spotCard on Drive: a status line for screen readers and a box for the cards (hidden while there are none). */
function buildSpotHost() {
  const box = document.getElementById("spotCard");
  if (!box) return;
  box.textContent = "";
  box.removeAttribute("aria-live");
  box.classList.add("pl-spothost");
  sr.drive = h("p", { class: "pl-sr", role: "status" });
  spotWrap = h("div", { class: "pl-spots", hidden: true });
  box.append(sr.drive, spotWrap);
}

/** Show the picker ("home"), the Car Party setup ("party") or one game. */
function showScreen(id, opts = {}) {
  if (!V) return;
  if (id !== "home" && id !== "party" && !defOf(id)) id = "home";
  if (screen !== id) {
    try { mods[screen]?.ctrl?.hide?.(); } catch (e) { console.error("[play] hide", e); }
    if (screen === "trivia" && T && T.mode === "speed") { try { T.speedCtrl?.hide?.(); } catch { /* not loaded */ } }
  }
  screen = id;
  V.home.hidden = id !== "home";
  V.partyPane.hidden = id !== "party";
  for (const [k, p] of Object.entries(V.panes)) p.hidden = k !== id;
  if (defOf(id)) { game = id; if (!opts.quiet) save("playGame", id); }
  renderScreen();
  if (!opts.quiet && viewVisible()) {
    // a new screen: its heading in view, focus on the way back (a keyboard user lands where the action is)
    try { window.scrollTo(0, 0); } catch { /* no scrolling */ }
    const back = (id === "home" ? null : (id === "party" ? V.partyPane : V.panes[id])?.querySelector(".pl-back"));
    if (back) back.focus({ preventScroll: true });
    else if (id === "home") { const b = V.home.querySelector(`[data-g="${game}"]`); b && b.focus({ preventScroll: true }); }
  }
}
function setGame(id, quiet = false) {
  if (!defOf(id)) return;
  const switching = screen !== id;
  if (id === "trivia" && switching && !quiet) freshen();
  showScreen(id, { quiet });
}
function renderScreen() {
  if (!V) return;
  if (screen === "home") return renderHome();
  if (screen === "party") {
    V.partyPane.querySelector(".pl-party")?.dispose?.();
    V.partyPane.querySelector(".pl-party")?.remove();
    if (party) V.partyPane.append(party.panel());
    return;
  }
  const d = defOf(screen);
  if (!d) return;
  if (d.core) {
    if (screen === "trivia") { renderTrivia(); if (T && T.mode === "speed") T.speedCtrl?.show?.(); }
    else if (screen === "spy") renderSpy();
    else renderBingo();
    return;
  }
  openMod(screen);
}
function renderGame() { renderScreen(); }

/* ---------- loading the games that live in js/games/ ---------- */
function makeCtx(def, body) {
  return {
    api, def, pane: body, safe,
    h, add, svg, icon, logo, shuffle, num, pick, clamp, reduced, countUp, firstSentence, shortName, fmtDate, thousands, sameish, colorStyle,
    LINES: WORDS, WYR, wyrSpeech, alphaSpeech, ALPHA_TIPS,
    S, settings, D, store, save, party,
    say: gameSay, autoSay, autoOk, canSpeak, navigating, chime, buzz, toast, unlock, announce, openPlace, placeById, mileLabel, regionName,
    hasPos, driving, roadEnd, cheer, closeWin, gamePhoto, voiceBusy,
    shown: () => screen === def.id && viewVisible() && !document.hidden,
    tripAt: () => num(store("playTripAt", 0)),
    newTrip,
    trivia: { questions: allQs, choiceText, LETTERS, backToClassic: () => setTriviaMode("classic") },
  };
}
function openMod(id) {
  const d = defOf(id), body = V && V.bodies[id];
  if (!d || !body || !d.file) return Promise.resolve(false);
  let m = mods[id];
  if (m && m.state === "ready") { try { m.ctrl.show?.(); } catch (e) { console.error(`[play] ${id} show`, e); } return m.promise; }
  if (m && m.state === "loading") return m.promise;
  m = mods[id] = { state: "loading", ctrl: null, promise: null };
  body.textContent = "";
  body.append(h("p", { class: "pl-loading", role: "status" }, t("play.getting_the_game_ready")));
  m.promise = import(`./games/${d.file}.js`).then(mod => {
    body.textContent = "";
    m.ctrl = mod.create(makeCtx(d, body)) || {};
    m.state = "ready";
    m.promise = Promise.resolve(true);
    if (screen === id) m.ctrl.show?.();
    return true;
  }).catch(e => {
    console.error(`[play] ${id} did not load`, e);
    mods[id] = null;
    body.textContent = "";
    body.append(h("div", { class: "pl-failed", role: "status" },
      h("p", null, t("play.this_game_could_not_load_it_needs_to")),
      h("button", { class: "primary", type: "button", onclick: safe(() => openMod(id), "retry") }, t("play.try_again"))));
    return false;
  });
  return m.promise;
}

/** A new trip begins (the person ended one, or tapped Start a fresh trip): Plate Hunt's "this trip" starts from now. */
function newTrip() {
  save("playTripAt", Date.now() + 1);   // +1: a plate found in this very millisecond belongs to the trip that just ended
  for (const m of Object.values(mods)) { try { m && m.ctrl && m.ctrl.tripChanged && m.ctrl.tripChanged(); } catch (e) { console.error("[play] tripChanged", e); } }
}

/* ---------- speed trivia: 10 questions on a clock, the same pool (js/games/speed.js) ---------- */
function setTriviaMode(mode) {
  if (!T) return;
  mode = mode === "speed" ? "speed" : "classic";
  T.mode = mode;
  for (const b of T.modes.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.tm === mode));
  T.stats.hidden = mode === "speed" || (!cur && !tscore.asked);
  T.box.hidden = mode === "speed";
  T.speedHost.hidden = mode !== "speed";
  if (mode === "speed") {
    if (T.speedCtrl) { T.speedCtrl.show?.(); return; }
    if (T.speedLoading) return;
    T.speedLoading = true;
    T.speedHost.textContent = "";
    T.speedHost.append(h("p", { class: "pl-loading", role: "status" }, t("play.getting_the_speed_round_ready")));
    import("./games/speed.js").then(mod => {
      T.speedHost.textContent = "";
      T.speedCtrl = mod.create(makeCtx({ id: "trivia", name: t("play.speed_trivia") }, T.speedHost)) || {};
      T.speedLoading = false;
      if (T.mode === "speed") T.speedCtrl.show?.();
    }).catch(e => {
      console.error("[play] speed trivia did not load", e);
      T.speedLoading = false;
      T.speedHost.textContent = "";
      T.speedHost.append(h("div", { class: "pl-failed", role: "status" }, h("p", null, t("play.the_speed_round_could_not_load_try")),
        h("button", { class: "primary", type: "button", onclick: safe(() => setTriviaMode("speed"), "retry speed") }, t("play.try_again"))));
    });
  } else {
    try { T.speedCtrl?.hide?.(); } catch { /* not loaded */ }
    renderTrivia();
  }
}

/* ---------- init ---------- */
export function init(a) {
  api = a || null;
  areaList = null;   // the bingo areas come from this api's road data
  if (!api) return;
  safe(loadCard, "load bingo")();
  if (!card) { try { card = dealCard(); } catch { card = null; } }
  safe(loadScore, "load trivia")();
  safe(loadSpy, "load spy")();
  if (!num(store("playTripAt", 0))) save("playTripAt", Date.now());
  party = null;
  try { party = createParty({ store, save }); } catch (e) { console.error("[play] party", e); }
  safe(buildView, "build view")();
  safe(buildSpotHost, "spot host")();
  safe(renderSpots, "render spots")();
  // iOS Safari only shows :active press states when a touch listener is around; and no double-tap zoom (CSS)
  for (const id of ["view-play", "spotCard"]) {
    try { document.getElementById(id)?.addEventListener("touchstart", () => {}, { passive: true }); } catch { /* old browsers */ }
  }

  const on = (evt, fn) => { try { api.bus?.on?.(evt, safe(fn, evt)); } catch (e) { console.error("[play] bus", e); } };
  on("tab", t => {
    const opened = t === "play" && lastTab !== "play";
    const left = lastTab === "play" && t !== "play";
    lastTab = t;
    if (left) { try { mods[screen]?.ctrl?.hide?.(); T?.speedCtrl?.hide?.(); } catch (e) { console.error("[play] hide", e); } }
    if (t !== "play") { closeWin(); return; }
    if (opened && game === "trivia") freshen();
    renderPassenger();
    if (opened) renderScreen(); else if (screen !== "home") { /* already showing */ } else renderHome();
  });
  on("pos", e => { onSpotPos(e); if (game === "bingo" && viewVisible()) renderBanner(); renderPassenger(); });
  on("place:announce", onAnnounce);
  on("speaking", onSpeaking);
  on("settings", () => {
    if (!settings().kid) clearSpots();
    if (screen === "spy" && viewVisible()) renderSpy();
  });
  on("mode", m => { if (m === "off") endTrip(); renderPassenger(); });
  on("trip:end", () => { endTrip(); newTrip(); });
  document.addEventListener("keydown", safe(e => {
    if (e.key === "Escape" && winEl) return closeWin();
    // A-D or 1-4 answers the trivia question on screen (keyboards and car remotes)
    if (e.ctrlKey || e.metaKey || e.altKey || screen !== "trivia" || (T && T.mode !== "classic") || !viewVisible() || !cur || cur.picked != null) return;
    if (e.target && e.target.closest && e.target.closest("input, select, textarea, [contenteditable], .sheet")) return;
    const k = e.key.toLowerCase();
    const i = "abcdef".indexOf(k) >= 0 ? "abcdef".indexOf(k) : "123456".indexOf(k);
    if (i >= 0 && i < cur.t.choices.length && k.length === 1) { e.preventDefault(); answerTrivia(i); }
  }, "keys"));

  api.play = {
    askTrivia: safe(askTrivia, "askTrivia"),
    readTrivia: safe(() => {
      // a question nobody can see right now may be stale; the one on screen is the one they mean
      if ((!viewVisible() || screen !== "trivia") && freshen()) renderTrivia();
      if (!cur) { pickQuestion(); renderTrivia(); }
      readQuestion();
    }, "readTrivia"),
    // i: choice index (0 = A); a letter or the answer's text also works. True only for a right answer.
    answerTrivia: safe(i => answerTrivia(Number.isInteger(i) ? i : cur ? parseAnswer(i, cur.t.choices) ?? -1 : -1, "voice") === true, "answerTrivia"),
    nextTrivia: safe(nextTrivia, "nextTrivia"),
    newBingoCard: safe(newCard, "newBingoCard"),
    // id: a game ("bingo", "trivia", "spy", "plates", "higher", "where", "wyr", "hunt", "alpha", "cows"), "party" for the
    // scoreboard, or nothing for the picker. Returns a promise that settles when a game that loads on demand is on screen.
    open: safe(id => {
      api.ui?.go?.("play");
      if (!id || id === "home") { showScreen("home"); return Promise.resolve(true); }
      if (id === "party") { showScreen("party"); return Promise.resolve(true); }
      if (!defOf(id)) return Promise.resolve(false);
      setGame(id);
      return (mods[id] && mods[id].promise) || Promise.resolve(true);
    }, "open"),
    score: () => ({ trivia: { ...tscore, streak }, spy: { points: spy.points, found: spy.found.filter(placeById).length },
      bingo: card ? { marked: marked(), lines: fullLines().length, full: !!card.full } : null }),
    // every fixed sentence the games can say, once each (the owner's recorded voice pre-renders exactly these)
    phrases: safe(phrases, "phrases"),
    phraseGroups: safe(phraseGroups, "phraseGroups"),
    // the Car Party scoreboard (see js/games/party.js) and the games' controllers, once opened (tests and other modules)
    party: () => party,
    games: () => GAME_DEFS.map(d => ({ id: d.id, name: d.name, line: d.line })),
    game: id => (mods[id] && mods[id].ctrl) || null,
    screen: () => screen,
  };
}
