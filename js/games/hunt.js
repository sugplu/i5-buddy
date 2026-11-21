// Scavenger Hunt: a list of things to spot, picked for the stretch of I-5 you are on (the app's passport regions), plus a
// few that work anywhere. Tap to check. Finish a list for a celebration and a stamp for that stretch.
// Everything regional is backed by the app's own data: an item is only offered in a region when its `proof` matches the
// text of the landmarks (or the stretch notes) that lie there. Items with no proof come from the app's bingo squares
// for that area or work on any road (a red truck). Store key "hunt": {lists: {regionId: {ids, done, at}}, stamps: {regionId: ms}, sel}.

import { t } from "../i18n.js";
import * as i18n from "../i18n.js";
const N = 14;   // items on a list

/** [id, emoji, words, regions, proof (regex on the region's text) | null, seasons | null]. null proof = a bingo-square classic for that area. */
export const ITEMS = [
  // San Diego and Orange County
  ["surf", "\u{1F3C4}", t("games.hunt.someone_with_a_surfboard"), ["sd"], /surf/i],
  ["lagoon", "\u{1F986}", t("games.hunt.a_lagoon_or_marsh_with_birds"), ["sd"], /lagoon|marsh/i],
  ["citrus", "\u{1F34B}", t("games.hunt.lemon_or_orange_trees"), ["sd"], /lemon|orange groves/i],
  ["train-sd", "\u{1F682}", t("games.hunt.a_train_beside_the_freeway"), ["sd"], /Surf Line|Amtrak/],
  ["navy", "\u{1F6A2}", t("games.hunt.a_navy_ship_on_the_bay"), ["sd"], /Naval Base/],
  ["coronado", "\u{1F309}", t("games.hunt.the_long_curving_coronado_bridge"), ["sd"], /Coronado Bridge/],
  ["jet-sd", "✈️", t("games.hunt.a_jet_coming_in_low_to_land"), ["sd"], /Lindbergh Field/],
  ["stadium", "\u{1F3DF}️", t("games.hunt.a_baseball_stadium"), ["sd"], /Angel Stadium/],
  ["flowers", "\u{1F338}", t("games.hunt.a_hillside_of_flowers_or_a_strawberry"), ["sd"], /Flower Fields|Strawberry Company/],
  ["checkpoint", "\u{1F6D1}", t("games.hunt.a_border_patrol_checkpoint_sign"), ["sd"], /Border Patrol checkpoint/],
  ["onofre", "⚡", t("games.hunt.the_two_round_domes_at_san_onofre"), ["sd"], /giant round domes/],
  ["ocean", "\u{1F30A}", t("games.hunt.the_pacific_ocean_out_the_window"), ["sd"], /\bocean\b/i],
  ["palm-sd", "\u{1F334}", t("games.hunt.a_palm_tree"), ["sd", "la"], null],
  ["coaster", "\u{1F3A2}", t("games.hunt.a_roller_coaster"), ["sd"], /Disneyland/],
  ["mission-sign", "⛪", t("games.hunt.a_sign_for_a_california_mission"), ["sd", "la"], "mission"],
  // Los Angeles and the Grapevine
  ["skyline", "\u{1F3D9}️", t("games.hunt.the_downtown_los_angeles_skyline"), ["la"], /skyline/i],
  ["interchange", "\u{1F6E3}️", t("games.hunt.a_tangle_of_freeway_ramps"), ["la"], /Interchange/],
  ["train-la", "\u{1F682}", t("games.hunt.a_commuter_or_freight_train"), ["la"], /trains still use the tunnel|Amtrak/],
  ["griffith", "\u{1F3DE}️", t("games.hunt.the_brushy_hills_of_griffith_park"), ["la"], /Griffith Park/],
  ["studio", "\u{1F3AC}", t("games.hunt.a_movie_studio_lot"), ["la"], /studio lot/i],
  ["aqueduct-la", "\u{1F4A7}", t("games.hunt.the_cascades_the_end_of_the_los"), ["la"], /Aqueduct Cascades/],
  ["castaic", "\u{1F30A}", t("games.hunt.a_big_lake_in_the_hills"), ["la"], /Castaic Lake|Pyramid Lake/],
  ["oil-la", "\u{1F6E2}️", t("games.hunt.an_oil_derrick"), ["la"], /oil well/i],
  ["pine", "\u{1F332}", t("games.hunt.pine_trees_on_the_mountain"), ["la"], /pine-covered/i],
  ["wildflowers", "\u{1F33C}", t("games.hunt.wildflowers_beside_the_road"), ["la"], /wildflowers/i, ["spring"]],
  ["grapevine", "\u{1F69B}", t("games.hunt.a_big_rig_crawling_up_the_grapevine"), ["la"], /Grapevine grade/],
  ["fort-tejon", "\u{1F3DA}️", t("games.hunt.the_old_adobe_buildings_of_fort_tejon"), ["la"], /Fort Tejon/],
  ["snow-tejon", "❄️", t("games.hunt.snow_on_the_pass"), ["la"], /Snow and ice close I-5/, ["winter"]],
  ["olive-la", "\u{1F33F}", t("games.hunt.olive_trees"), ["la"], /olives/i],
  // the Westside
  ["almond", "\u{1F333}", t("games.hunt.almond_trees_in_neat_rows"), ["ws"], /almond/i],
  ["pistachio", "\u{1F95C}", t("games.hunt.pistachio_trees"), ["ws"], /pistachio/i],
  ["pumpjack", "\u{1F6E2}️", t("games.hunt.an_oil_pumpjack_nodding"), ["ws"], /oil field/i],
  ["cattle-ws", "\u{1F404}", t("games.hunt.cattle_in_a_pasture_or_feedlot"), ["ws"], /feedlot/i],
  ["cotton", "☁️", t("games.hunt.a_cotton_field"), ["ws"], /Cotton country|cotton farming/i],
  ["tomato-ws", "\u{1F345}", t("games.hunt.a_tomato_truck_or_field"), ["ws"], /Tomato country/],
  ["aqueduct-ws", "\u{1F30A}", t("games.hunt.the_california_aqueduct_a_long"), ["ws"], /California Aqueduct/],
  ["powerlines", "⚡", t("games.hunt.giant_power_lines_marching_across_the"), ["ws"], /power lines|Substation|Path 15/i],
  ["windmill", "\u{1F32C}️", t("games.hunt.the_windmill_at_pea_soup_andersens"), ["ws"], /working windmill/i],
  ["garlic", "\u{1F331}", t("games.hunt.a_garlic_field"), ["ws"], /Garlic country/],
  ["fog", "\u{1F32B}️", t("games.hunt.tule_fog_hugging_the_fields"), ["ws"], /tule fog/i, ["fall", "winter"]],
  ["tractor", "\u{1F69C}", t("games.hunt.a_tractor_in_a_field"), ["ws", "sv"], null],
  ["bees", "\u{1F41D}", t("games.hunt.boxes_of_honeybees"), ["ws"], null],
  ["duster", "\u{1F6E9}️", t("games.hunt.a_crop_duster_plane"), ["ws", "sv"], null],
  ["diablo", "⛰️", t("games.hunt.mount_diablos_double_peak_far_off"), ["ws"], /Mount Diablo/],
  // the Delta and Capital
  ["tower-bridge", "\u{1F309}", t("games.hunt.the_gold_towers_of_tower_bridge"), ["dc"], /Tower Bridge/],
  ["capitol", "\u{1F3DB}️", t("games.hunt.the_capitol_dome"), ["dc"], /state capital/i],
  ["train-dc", "\u{1F682}", t("games.hunt.a_train_or_a_railroad_yard"), ["dc"], /Railroad Museum|railroad town/i],
  ["vineyard", "\u{1F347}", t("games.hunt.rows_of_grapevines"), ["dc"], /vineyards/i],
  ["cranes", "\u{1F986}", t("games.hunt.ducks_geese_or_sandhill_cranes"), ["dc"], /sandhill cranes|cranes arrive/i],
  ["levee", "\u{1F33E}", t("games.hunt.a_levee_road_beside_the_water"), ["dc"], null],
  ["river-dc", "\u{1F30A}", t("games.hunt.a_big_river_under_the_freeway"), ["dc"], /Crossing the Sacramento River|Mokelumne/],
  ["sunflower", "\u{1F33B}", t("games.hunt.sunflowers"), ["dc"], /Sunflower seed fields/, ["summer"]],
  ["tomato-dc", "\u{1F345}", t("games.hunt.a_tomato_cannery_or_tomato_trucks"), ["dc"], /tomato cannery/i],
  ["rice-dc", "\u{1F33E}", t("games.hunt.rice_fields"), ["dc"], /Yolo Bypass/],
  ["dairy", "\u{1F404}", t("games.hunt.dairy_cows"), ["dc"], /dairy/i],
  ["oak", "\u{1F333}", t("games.hunt.a_giant_oak_tree"), ["dc"], null],
  // the Sacramento Valley
  ["almond-sv", "\u{1F333}", t("games.hunt.almond_orchards"), ["sv"], /almond/i],
  ["rice-sv", "\u{1F33E}", t("games.hunt.rice_paddies"), ["sv"], /Rice country/],
  ["buttes", "⛰️", t("games.hunt.the_sutter_buttes_rising_from_the_flat"), ["sv"], /Sutter Buttes/],
  ["geese", "\u{1F986}", t("games.hunt.geese_or_pelicans_at_a_wildlife_refuge"), ["sv"], /snow geese|white pelicans/i],
  ["walnut", "\u{1F330}", t("games.hunt.walnut_orchards"), ["sv"], /Walnut orchards/],
  ["olive-sv", "\u{1F33F}", t("games.hunt.olive_trees"), ["sv"], /olive town/i],
  ["prune", "\u{1F338}", t("games.hunt.prune_orchards"), ["sv"], /Prune orchards/],
  ["bees-sv", "\u{1F41D}", t("games.hunt.a_sign_about_bees_or_honey"), ["sv"], /Queen Bee/i],
  ["shasta-far", "\u{1F3D4}️", t("games.hunt.mount_shasta_far_off_on_the_skyline"), ["sv"], /Mount Shasta from afar|lone peak/i],
  ["creek", "\u{1F30A}", t("games.hunt.a_creek_under_the_freeway"), ["sv"], /crosses (Stony|Thomes|Cottonwood) Creek/i],
  ["casino", "\u{1F3B0}", t("games.hunt.a_casino_sign"), ["sv"], /Casino/],
  ["hawk", "\u{1F985}", t("games.hunt.a_hawk_on_a_post"), ["sv", "sh"], null],
  // Shasta Country
  ["shasta", "\u{1F3D4}️", t("games.hunt.mount_shasta"), ["sh"], /Mount Shasta rises/],
  ["pit-river", "\u{1F309}", t("games.hunt.the_double_decker_pit_river_bridge"), ["sh"], /double-decker/],
  ["lake-shasta", "\u{1F30A}", t("games.hunt.lake_shasta"), ["sh"], /Shasta Lake/],
  ["houseboat", "\u{1F6E5}️", t("games.hunt.a_houseboat_on_lake_shasta"), ["sh"], /houseboats/i],
  ["train-sh", "\u{1F682}", t("games.hunt.a_train_in_the_canyon"), ["sh"], /railroad runs underneath|Cascade Line|railroad town/i],
  ["black-butte", "⛰️", t("games.hunt.black_buttes_dark_cone"), ["sh"], /dark cone close beside the freeway/],
  ["lassen", "\u{1F3D4}️", t("games.hunt.lassen_peak_far_off"), ["sh"], /Lassen Peak/],
  ["crags", "⛰️", t("games.hunt.the_granite_spires_of_castle_crags"), ["sh"], /Castle Crags/],
  ["logtruck", "\u{1F69B}", t("games.hunt.a_log_truck"), ["sh"], null],
  ["snow-sh", "❄️", t("games.hunt.snow_on_the_ground"), ["sh"], null, ["winter", "spring"]],
  ["chain", "⛓️", t("games.hunt.a_chain_up_area"), ["sh"], null],
  ["klamath", "\u{1F30A}", t("games.hunt.the_klamath_river"), ["sh"], /freeway crosses the Klamath River/i],
  ["cattle-sh", "\u{1F404}", t("games.hunt.cattle_on_rangeland"), ["sh"], /cattle country|rangeland/i],
  // anywhere
  ["red-truck", "\u{1F69A}", t("games.hunt.a_red_truck"), ["*"], null],
  ["rv", "\u{1F690}", t("games.hunt.an_rv_or_a_camper_van"), ["*"], null],
  ["dog", "\u{1F415}", t("games.hunt.a_dog_in_a_car_window"), ["*"], null],
  ["plate", "\u{1F698}", t("games.hunt.a_license_plate_from_another_state"), ["*"], null],
  ["bigrig", "\u{1F69B}", t("games.hunt.a_big_rig_with_two_trailers"), ["*"], null],
  ["motorcycle", "\u{1F3CD}️", t("games.hunt.a_motorcycle"), ["*"], null],
  ["school-bus", "\u{1F68C}", t("games.hunt.a_school_bus"), ["*"], null],
  ["bikes", "\u{1F6B2}", t("games.hunt.bikes_on_a_car"), ["*"], null],
  ["boat", "\u{1F6A4}", t("games.hunt.a_boat_on_a_trailer"), ["*"], null],
  ["patrol", "\u{1F693}", t("games.hunt.a_highway_patrol_car"), ["*"], null],
  ["horse", "\u{1F434}", t("games.hunt.a_horse_trailer_or_a_horse_in_a_field"), ["*"], null],
  ["rest", "\u{1F6BB}", t("games.hunt.a_rest_area_sign"), ["*"], null],
];
const BY_ID = new Map(ITEMS.map(it => [it[0], it]));
const REGION_SEASON = d => { try { return d.seasonOf ? d.seasonOf(new Date()) : null; } catch { return null; } };

export function create(ctx) {
  const { h, icon, safe, shuffle, fmtDate } = ctx;
  const host = ctx.pane;
  const D = () => ctx.D();
  const regions = () => (Array.isArray(D().REGIONS) ? D().REGIONS : []).filter(r => r && r.id && isFinite(r.from) && isFinite(r.to));
  const rec0 = () => { const r = ctx.store("hunt", null); return r && typeof r === "object" ? r : {}; };
  let st = loadState();
  let sel = null;   // the region id on screen
  const live = h("p", { class: "pl-sr", role: "status" });
  let confirmEl = null;

  function loadState() {
    const r = rec0(), lists = {}, stamps = {};
    for (const [rid, l] of Object.entries(r.lists && typeof r.lists === "object" ? r.lists : {})) {
      if (!l || !Array.isArray(l.ids)) continue;
      const ids = l.ids.filter(id => BY_ID.has(id));
      if (ids.length < 3) continue;
      lists[rid] = { ids, done: (Array.isArray(l.done) ? l.done : []).filter(id => ids.includes(id)), at: ctx.num(l.at) };
    }
    for (const [rid, t] of Object.entries(r.stamps && typeof r.stamps === "object" ? r.stamps : {})) if (typeof t === "number" && isFinite(t)) stamps[rid] = t;
    return { lists, stamps, sel: typeof r.sel === "string" ? r.sel : null };
  }
  const saveState = () => ctx.save("hunt", st);

  /* ---------- what the data says about a stretch of road ---------- */
  const textCache = new Map();
  function regionText(r) {
    if (textCache.has(r.id)) return textCache.get(r.id);
    const P = (Array.isArray(D().PLACES) ? D().PLACES : []).filter(p => p && p.m >= r.from && p.m < r.to);
    const Z = (Array.isArray(D().ZONES) ? D().ZONES : []).filter(z => z && z.to > r.from && z.from < r.to);
    const t = P.map(p => `${p.name}. ${p.text || ""} ${p.more || ""}`).join("\n") + "\n" + Z.map(z => `${z.label}. ${z.text || ""} ${Object.values(z.seasons || {}).join(" ")}`).join("\n");
    textCache.set(r.id, { t, P });
    return textCache.get(r.id);
  }
  /** The items this region can offer today, each backed by the data (or a bingo classic for the area). */
  function eligible(r) {
    const { t, P } = regionText(r);
    const season = REGION_SEASON(D());
    return ITEMS.filter(it => {
      const [, , , regs, proof, seasons] = it;
      if (!regs.includes(r.id)) return false;
      if (seasons && season && !seasons.includes(season)) return false;
      if (proof === "mission") return P.some(p => p.mission != null);
      if (proof instanceof RegExp) return proof.test(t);
      return true;
    });
  }
  const universal = () => ITEMS.filter(it => it[3].includes("*"));

  function deal(r) {
    const reg = shuffle(eligible(r).filter(it => !it[3].includes("*")));
    const uni = shuffle(universal());
    const nUni = Math.max(4, N - Math.min(reg.length, N - 4));
    const picks = shuffle([...reg.slice(0, N - nUni), ...uni.slice(0, nUni)]).slice(0, N);
    return { ids: picks.map(it => it[0]), done: [], at: Date.now() };
  }
  function listFor(r) {
    let l = st.lists[r.id];
    if (!l) { l = st.lists[r.id] = deal(r); saveState(); }
    return l;
  }
  const here = () => { if (!ctx.hasPos()) return null; try { return D().regionAt?.(ctx.S().m) || null; } catch { return null; } };
  const regionById = id => regions().find(r => r.id === id) || null;
  function pickRegion() {
    const hr = here();
    return (hr && regionById(hr.id)) || regionById(st.sel) || regions()[0] || null;
  }

  /* ---------- play ---------- */
  function toggle(id) {
    const r = regionById(sel);
    if (!r) return false;
    const l = listFor(r);
    if (!l.ids.includes(id)) return false;
    const was = l.done.includes(id);
    l.done = was ? l.done.filter(x => x !== id) : [...l.done, id];
    saveState();
    const complete = !was && l.done.length === l.ids.length;
    if (!was) { ctx.chime(complete ? "success" : "soft"); ctx.buzz(20); }
    render(id);
    const it = BY_ID.get(id);
    ctx.announce(t("games.hunt.x1_x2_length_of_length2", { x1: it[2], x2: was ? t("games.hunt.unchecked") : t("games.hunt.checked"), length: l.done.length, length2: l.ids.length }));
    if (complete) finishList(r);
    return !was;
  }
  function finishList(r) {
    const first = !st.stamps[r.id];
    st.stamps[r.id] = Date.now();
    saveState();
    render();
    if (first) ctx.cheer({ top: t("games.hunt.scavenger_hunt"), title: t("games.hunt.all_found"), sub: t("games.hunt.a_stamp_for_name", { name: r.name }), speak: [ctx.LINES.hunt.done, "play:hunt:done"] });
    else ctx.toast(t("games.hunt.you_found_everything_on_this_list", { name: r.name }));
  }
  function newList() {
    const r = regionById(sel);
    if (!r) return;
    st.lists[r.id] = deal(r);
    saveState();
    if (confirmEl) confirmEl.hidden = true;
    render();
    ctx.announce(t("games.hunt.here_is_a_fresh_list"));
  }
  function select(id) { if (regionById(id)) { sel = id; st.sel = id; saveState(); render(); } }

  /* ---------- drawing ---------- */
  function stampEl(r, t) {
    return h("li", { class: "pl-stamp" + (t ? " on" : ""), "aria-label": `${r.name}: ${t ? i18n.t("games.hunt.stamped_t", { t: fmtDate(t) }) : i18n.t("games.hunt.no_stamp_yet")}` },
      h("span", { class: "pl-stamp-ring", "aria-hidden": "true" }, t ? icon("check", "pl-ic") : null),
      h("span", { class: "pl-stamp-t", "aria-hidden": "true" }, r.name.split(" & ")[0].split(" and ")[0]));
  }
  function render(freshId) {
    host.textContent = "";
    const R = regions();
    if (!R.length) {
      host.append(h("div", { class: "pl-q pl-empty" }, h("p", { class: "pl-qt" }, t("games.hunt.this_game_needs_the_roads_regions")), h("p", { class: "pl-why" }, t("games.hunt.they_come_with_the_apps_road_data"))));
      return;
    }
    if (!sel || !regionById(sel)) sel = pickRegion().id;
    const r = regionById(sel);
    const l = listFor(r);
    const hr = here();
    // which stretch
    host.append(h("div", { class: "pl-hregions", role: "group", "aria-label": t("games.hunt.stretch_of_road") },
      R.map(x => h("button", { class: "pl-hreg" + (st.stamps[x.id] ? " stamped" : ""), type: "button", "data-r": x.id, "aria-pressed": String(x.id === sel),
        "aria-label": `${x.name}${st.stamps[x.id] ? t("games.hunt.stamped") : ""}${hr && hr.id === x.id ? t("games.hunt.you_are_here") : ""}`, onclick: safe(() => select(x.id), "region") },
        h("span", { "aria-hidden": "true" }, shortRegion(x.name)), hr && hr.id === x.id ? h("i", { class: "pl-hreg-here", "aria-hidden": "true" }) : null, st.stamps[x.id] ? icon("check", "pl-ic pl-hreg-ck") : null))));
    if (hr && hr.id !== sel && regionById(hr.id)) {
      host.append(h("div", { class: "pl-banner" }, h("span", null, t("games.hunt.you_are_in_name_now", { name: hr.name })),
        h("button", { class: "link", type: "button", "data-k": "switch", onclick: safe(() => select(hr.id), "switch") }, t("games.hunt.switch_to_its_list"))));
    }
    const done = l.done.length, total = l.ids.length;
    host.append(h("div", { class: "pl-pl-stats pl-hunt-head" },
      h("div", { class: "pl-pl-big" }, h("b", { class: "pl-pl-n" }, t("games.hunt.done_of_total", { done, total })), h("span", null, t("games.hunt.spotted"))),
      h("div", { class: "pl-pl-bar", role: "img", "aria-label": t("games.hunt.done_of_total_spotted", { done, total }) }, h("i", { style: `width:${Math.round(done / total * 100)}%` })),
      h("p", { class: "pl-pl-sub" }, t("games.hunt.look_for_these_in_name", { name: r.name }), st.stamps[r.id] ? t("games.hunt.stamped_x1", { x1: fmtDate(st.stamps[r.id]) }) : "")));
    const ul = h("ul", { class: "pl-hlist" });
    for (const id of l.ids) {
      const it = BY_ID.get(id), on = l.done.includes(id);
      ul.append(h("li", null, h("button", { class: "pl-hitem" + (on ? " on" : "") + (id === freshId ? " fresh" : ""), type: "button", "data-id": id, "aria-pressed": String(on),
        onclick: safe(() => toggle(id), "item " + id) },
        h("span", { class: "pl-hitem-e", "aria-hidden": "true" }, it[1]),
        h("span", { class: "pl-hitem-t" }, it[2]),
        h("span", { class: "pl-hitem-c", "aria-hidden": "true" }, on ? icon("check", "pl-ic") : null))));
    }
    host.append(ul);
    confirmEl = h("div", { class: "pl-confirm", hidden: true, role: "group", "aria-label": t("games.hunt.start_a_fresh_list") },
      h("p", null, t("games.hunt.deal_a_new_list_for_this_stretch_the")),
      h("div", { class: "pl-row" },
        h("button", { class: "secondary", type: "button", "data-k": "keep", onclick: () => { confirmEl.hidden = true; host.querySelector('[data-k="new"]').focus({ preventScroll: true }); } }, t("games.hunt.keep_this_list")),
        h("button", { class: "primary", type: "button", "data-k": "new-yes", onclick: safe(newList, "new list") }, t("games.hunt.new_list"))));
    host.append(h("div", { class: "pl-row pl-hfoot" },
      h("button", { class: "secondary pl-new", type: "button", "data-k": "new", onclick: safe(() => { if (!l.done.length) return newList(); confirmEl.hidden = false; confirmEl.querySelector("button.secondary").focus({ preventScroll: true }); try { confirmEl.scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ } }, "ask new list") }, icon("shuffle"), t("games.hunt.new_list")),
      h("p", { class: "pl-how" }, t("games.hunt.tap_an_item_when_someone_in_the_car"))), confirmEl);
    host.append(h("h3", { class: "sub" }, t("games.hunt.stamp_book_length_of_length2", { length: Object.keys(st.stamps).filter(k => regionById(k)).length, length2: R.length })), h("ul", { class: "pl-stamps" }, R.map(x => stampEl(x, st.stamps[x.id]))), live);
  }
  const shortRegion = n => n.split(" & ")[0].split(" and ")[0].replace(/^The /, "").replace("Country", "").trim();

  render();
  return {
    show() { const hr = here(); if (hr && !sel) sel = hr.id; render(); },
    hide() {},
    toggle, select, newList,
    eligible: rid => { const r = regionById(rid); return r ? eligible(r).map(it => it[0]) : []; },
    state: () => { const r = regionById(sel); const l = r && st.lists[r.id]; return { region: sel, ids: l ? l.ids.slice() : [], done: l ? l.done.slice() : [], stamps: { ...st.stamps }, total: l ? l.ids.length : 0 }; },
  };
}
