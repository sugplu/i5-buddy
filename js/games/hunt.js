// Scavenger Hunt: a list of things to spot, picked for the stretch of I-5 you are on (the app's passport regions), plus a
// few that work anywhere. Tap to check. Finish a list for a celebration and a stamp for that stretch.
// Everything regional is backed by the app's own data: an item is only offered in a region when its `proof` matches the
// text of the landmarks (or the stretch notes) that lie there. Items with no proof come from the app's bingo squares
// for that area or work on any road (a red truck). Store key "hunt": {lists: {regionId: {ids, done, at}}, stamps: {regionId: ms}, sel}.

const N = 14;   // items on a list

/** [id, emoji, words, regions, proof (regex on the region's text) | null, seasons | null]. null proof = a bingo-square classic for that area. */
export const ITEMS = [
  // San Diego and Orange County
  ["surf", "\u{1F3C4}", "Someone with a surfboard", ["sd"], /surf/i],
  ["lagoon", "\u{1F986}", "A lagoon or marsh with birds", ["sd"], /lagoon|marsh/i],
  ["citrus", "\u{1F34B}", "Lemon or orange trees", ["sd"], /lemon|orange groves/i],
  ["train-sd", "\u{1F682}", "A train beside the freeway", ["sd"], /Surf Line|Amtrak/],
  ["navy", "\u{1F6A2}", "A Navy ship on the bay", ["sd"], /Naval Base/],
  ["coronado", "\u{1F309}", "The long curving Coronado Bridge", ["sd"], /Coronado Bridge/],
  ["jet-sd", "✈️", "A jet coming in low to land", ["sd"], /Lindbergh Field/],
  ["stadium", "\u{1F3DF}️", "A baseball stadium", ["sd"], /Angel Stadium/],
  ["flowers", "\u{1F338}", "A hillside of flowers or a strawberry field", ["sd"], /Flower Fields|Strawberry Company/],
  ["checkpoint", "\u{1F6D1}", "A Border Patrol checkpoint sign", ["sd"], /Border Patrol checkpoint/],
  ["onofre", "⚡", "The two round domes at San Onofre", ["sd"], /giant round domes/],
  ["ocean", "\u{1F30A}", "The Pacific Ocean out the window", ["sd"], /\bocean\b/i],
  ["palm-sd", "\u{1F334}", "A palm tree", ["sd", "la"], null],
  ["coaster", "\u{1F3A2}", "A roller coaster", ["sd"], /Disneyland/],
  ["mission-sign", "⛪", "A sign for a California mission", ["sd", "la"], "mission"],
  // Los Angeles and the Grapevine
  ["skyline", "\u{1F3D9}️", "The downtown Los Angeles skyline", ["la"], /skyline/i],
  ["interchange", "\u{1F6E3}️", "A tangle of freeway ramps", ["la"], /Interchange/],
  ["train-la", "\u{1F682}", "A commuter or freight train", ["la"], /trains still use the tunnel|Amtrak/],
  ["griffith", "\u{1F3DE}️", "The brushy hills of Griffith Park", ["la"], /Griffith Park/],
  ["studio", "\u{1F3AC}", "A movie studio lot", ["la"], /studio lot/i],
  ["aqueduct-la", "\u{1F4A7}", "The Cascades, the end of the Los Angeles Aqueduct", ["la"], /Aqueduct Cascades/],
  ["castaic", "\u{1F30A}", "A big lake in the hills", ["la"], /Castaic Lake|Pyramid Lake/],
  ["oil-la", "\u{1F6E2}️", "An oil derrick", ["la"], /oil well/i],
  ["pine", "\u{1F332}", "Pine trees on the mountain", ["la"], /pine-covered/i],
  ["wildflowers", "\u{1F33C}", "Wildflowers beside the road", ["la"], /wildflowers/i, ["spring"]],
  ["grapevine", "\u{1F69B}", "A big rig crawling up the Grapevine", ["la"], /Grapevine grade/],
  ["fort-tejon", "\u{1F3DA}️", "The old adobe buildings of Fort Tejon", ["la"], /Fort Tejon/],
  ["snow-tejon", "❄️", "Snow on the pass", ["la"], /Snow and ice close I-5/, ["winter"]],
  ["olive-la", "\u{1F33F}", "Olive trees", ["la"], /olives/i],
  // the Westside
  ["almond", "\u{1F333}", "Almond trees in neat rows", ["ws"], /almond/i],
  ["pistachio", "\u{1F95C}", "Pistachio trees", ["ws"], /pistachio/i],
  ["pumpjack", "\u{1F6E2}️", "An oil pumpjack, nodding", ["ws"], /oil field/i],
  ["cattle-ws", "\u{1F404}", "Cattle in a pasture or feedlot", ["ws"], /feedlot/i],
  ["cotton", "☁️", "A cotton field", ["ws"], /Cotton country|cotton farming/i],
  ["tomato-ws", "\u{1F345}", "A tomato truck or field", ["ws"], /Tomato country/],
  ["aqueduct-ws", "\u{1F30A}", "The California Aqueduct, a long concrete channel", ["ws"], /California Aqueduct/],
  ["powerlines", "⚡", "Giant power lines marching across the fields", ["ws"], /power lines|Substation|Path 15/i],
  ["windmill", "\u{1F32C}️", "The windmill at Pea Soup Andersen's", ["ws"], /working windmill/i],
  ["garlic", "\u{1F331}", "A garlic field", ["ws"], /Garlic country/],
  ["fog", "\u{1F32B}️", "Tule fog hugging the fields", ["ws"], /tule fog/i, ["fall", "winter"]],
  ["tractor", "\u{1F69C}", "A tractor in a field", ["ws", "sv"], null],
  ["bees", "\u{1F41D}", "Boxes of honeybees", ["ws"], null],
  ["duster", "\u{1F6E9}️", "A crop duster plane", ["ws", "sv"], null],
  ["diablo", "⛰️", "Mount Diablo's double peak, far off", ["ws"], /Mount Diablo/],
  // the Delta and Capital
  ["tower-bridge", "\u{1F309}", "The gold towers of Tower Bridge", ["dc"], /Tower Bridge/],
  ["capitol", "\u{1F3DB}️", "The Capitol dome", ["dc"], /state capital/i],
  ["train-dc", "\u{1F682}", "A train or a railroad yard", ["dc"], /Railroad Museum|railroad town/i],
  ["vineyard", "\u{1F347}", "Rows of grapevines", ["dc"], /vineyards/i],
  ["cranes", "\u{1F986}", "Ducks, geese or sandhill cranes", ["dc"], /sandhill cranes|cranes arrive/i],
  ["levee", "\u{1F33E}", "A levee road beside the water", ["dc"], null],
  ["river-dc", "\u{1F30A}", "A big river under the freeway", ["dc"], /Crossing the Sacramento River|Mokelumne/],
  ["sunflower", "\u{1F33B}", "Sunflowers", ["dc"], /Sunflower seed fields/, ["summer"]],
  ["tomato-dc", "\u{1F345}", "A tomato cannery or tomato trucks", ["dc"], /tomato cannery/i],
  ["rice-dc", "\u{1F33E}", "Rice fields", ["dc"], /Yolo Bypass/],
  ["dairy", "\u{1F404}", "Dairy cows", ["dc"], /dairy/i],
  ["oak", "\u{1F333}", "A giant oak tree", ["dc"], null],
  // the Sacramento Valley
  ["almond-sv", "\u{1F333}", "Almond orchards", ["sv"], /almond/i],
  ["rice-sv", "\u{1F33E}", "Rice paddies", ["sv"], /Rice country/],
  ["buttes", "⛰️", "The Sutter Buttes rising from the flat fields", ["sv"], /Sutter Buttes/],
  ["geese", "\u{1F986}", "Geese or pelicans at a wildlife refuge", ["sv"], /snow geese|white pelicans/i],
  ["walnut", "\u{1F330}", "Walnut orchards", ["sv"], /Walnut orchards/],
  ["olive-sv", "\u{1F33F}", "Olive trees", ["sv"], /olive town/i],
  ["prune", "\u{1F338}", "Prune orchards", ["sv"], /Prune orchards/],
  ["bees-sv", "\u{1F41D}", "A sign about bees or honey", ["sv"], /Queen Bee/i],
  ["shasta-far", "\u{1F3D4}️", "Mount Shasta, far off on the skyline", ["sv"], /Mount Shasta from afar|lone peak/i],
  ["creek", "\u{1F30A}", "A creek under the freeway", ["sv"], /crosses (Stony|Thomes|Cottonwood) Creek/i],
  ["casino", "\u{1F3B0}", "A casino sign", ["sv"], /Casino/],
  ["hawk", "\u{1F985}", "A hawk on a post", ["sv", "sh"], null],
  // Shasta Country
  ["shasta", "\u{1F3D4}️", "Mount Shasta", ["sh"], /Mount Shasta rises/],
  ["pit-river", "\u{1F309}", "The double-decker Pit River Bridge", ["sh"], /double-decker/],
  ["lake-shasta", "\u{1F30A}", "Lake Shasta", ["sh"], /Shasta Lake/],
  ["houseboat", "\u{1F6E5}️", "A houseboat on Lake Shasta", ["sh"], /houseboats/i],
  ["train-sh", "\u{1F682}", "A train in the canyon", ["sh"], /railroad runs underneath|Cascade Line|railroad town/i],
  ["black-butte", "⛰️", "Black Butte's dark cone", ["sh"], /dark cone close beside the freeway/],
  ["lassen", "\u{1F3D4}️", "Lassen Peak, far off", ["sh"], /Lassen Peak/],
  ["crags", "⛰️", "The granite spires of Castle Crags", ["sh"], /Castle Crags/],
  ["logtruck", "\u{1F69B}", "A log truck", ["sh"], null],
  ["snow-sh", "❄️", "Snow on the ground", ["sh"], null, ["winter", "spring"]],
  ["chain", "⛓️", "A chain-up area", ["sh"], null],
  ["klamath", "\u{1F30A}", "The Klamath River", ["sh"], /freeway crosses the Klamath River/i],
  ["cattle-sh", "\u{1F404}", "Cattle on rangeland", ["sh"], /cattle country|rangeland/i],
  // anywhere
  ["red-truck", "\u{1F69A}", "A red truck", ["*"], null],
  ["rv", "\u{1F690}", "An RV or a camper van", ["*"], null],
  ["dog", "\u{1F415}", "A dog in a car window", ["*"], null],
  ["plate", "\u{1F698}", "A license plate from another state", ["*"], null],
  ["bigrig", "\u{1F69B}", "A big rig with two trailers", ["*"], null],
  ["motorcycle", "\u{1F3CD}️", "A motorcycle", ["*"], null],
  ["school-bus", "\u{1F68C}", "A school bus", ["*"], null],
  ["bikes", "\u{1F6B2}", "Bikes on a car", ["*"], null],
  ["boat", "\u{1F6A4}", "A boat on a trailer", ["*"], null],
  ["patrol", "\u{1F693}", "A highway patrol car", ["*"], null],
  ["horse", "\u{1F434}", "A horse trailer or a horse in a field", ["*"], null],
  ["rest", "\u{1F6BB}", "A rest area sign", ["*"], null],
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
    ctx.announce(`${it[2]} ${was ? "unchecked" : "checked"}. ${l.done.length} of ${l.ids.length}.`);
    if (complete) finishList(r);
    return !was;
  }
  function finishList(r) {
    const first = !st.stamps[r.id];
    st.stamps[r.id] = Date.now();
    saveState();
    render();
    if (first) ctx.cheer({ top: "SCAVENGER HUNT", title: "ALL FOUND", sub: `A stamp for ${r.name}`, speak: [ctx.LINES.hunt.done, "play:hunt:done"] });
    else ctx.toast(`You found everything on this list again. ${r.name} keeps its stamp.`);
  }
  function newList() {
    const r = regionById(sel);
    if (!r) return;
    st.lists[r.id] = deal(r);
    saveState();
    if (confirmEl) confirmEl.hidden = true;
    render();
    ctx.announce("Here is a fresh list.");
  }
  function select(id) { if (regionById(id)) { sel = id; st.sel = id; saveState(); render(); } }

  /* ---------- drawing ---------- */
  function stampEl(r, t) {
    return h("li", { class: "pl-stamp" + (t ? " on" : ""), "aria-label": `${r.name}: ${t ? "stamped " + fmtDate(t) : "no stamp yet"}` },
      h("span", { class: "pl-stamp-ring", "aria-hidden": "true" }, t ? icon("check", "pl-ic") : null),
      h("span", { class: "pl-stamp-t", "aria-hidden": "true" }, r.name.split(" & ")[0].split(" and ")[0]));
  }
  function render(freshId) {
    host.textContent = "";
    const R = regions();
    if (!R.length) {
      host.append(h("div", { class: "pl-q pl-empty" }, h("p", { class: "pl-qt" }, "This game needs the road's regions."), h("p", { class: "pl-why" }, "They come with the app's road data.")));
      return;
    }
    if (!sel || !regionById(sel)) sel = pickRegion().id;
    const r = regionById(sel);
    const l = listFor(r);
    const hr = here();
    // which stretch
    host.append(h("div", { class: "pl-hregions", role: "group", "aria-label": "Stretch of road" },
      R.map(x => h("button", { class: "pl-hreg" + (st.stamps[x.id] ? " stamped" : ""), type: "button", "data-r": x.id, "aria-pressed": String(x.id === sel),
        "aria-label": `${x.name}${st.stamps[x.id] ? ", stamped" : ""}${hr && hr.id === x.id ? ", you are here" : ""}`, onclick: safe(() => select(x.id), "region") },
        h("span", { "aria-hidden": "true" }, shortRegion(x.name)), hr && hr.id === x.id ? h("i", { class: "pl-hreg-here", "aria-hidden": "true" }) : null, st.stamps[x.id] ? icon("check", "pl-ic pl-hreg-ck") : null))));
    if (hr && hr.id !== sel && regionById(hr.id)) {
      host.append(h("div", { class: "pl-banner" }, h("span", null, `You are in ${hr.name} now.`),
        h("button", { class: "link", type: "button", "data-k": "switch", onclick: safe(() => select(hr.id), "switch") }, "Switch to its list")));
    }
    const done = l.done.length, total = l.ids.length;
    host.append(h("div", { class: "pl-pl-stats pl-hunt-head" },
      h("div", { class: "pl-pl-big" }, h("b", { class: "pl-pl-n" }, `${done} of ${total}`), h("span", null, "spotted")),
      h("div", { class: "pl-pl-bar", role: "img", "aria-label": `${done} of ${total} spotted` }, h("i", { style: `width:${Math.round(done / total * 100)}%` })),
      h("p", { class: "pl-pl-sub" }, `Look for these in ${r.name}`, st.stamps[r.id] ? ` · stamped ${fmtDate(st.stamps[r.id])}` : "")));
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
    confirmEl = h("div", { class: "pl-confirm", hidden: true, role: "group", "aria-label": "Start a fresh list?" },
      h("p", null, "Deal a new list for this stretch? The checks on this one go away."),
      h("div", { class: "pl-row" },
        h("button", { class: "secondary", type: "button", "data-k": "keep", onclick: () => { confirmEl.hidden = true; host.querySelector('[data-k="new"]').focus({ preventScroll: true }); } }, "Keep this list"),
        h("button", { class: "primary", type: "button", "data-k": "new-yes", onclick: safe(newList, "new list") }, "New list")));
    host.append(h("div", { class: "pl-row pl-hfoot" },
      h("button", { class: "secondary pl-new", type: "button", "data-k": "new", onclick: safe(() => { if (!l.done.length) return newList(); confirmEl.hidden = false; confirmEl.querySelector("button.secondary").focus({ preventScroll: true }); try { confirmEl.scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ } }, "ask new list") }, icon("shuffle"), "New list"),
      h("p", { class: "pl-how" }, "Tap an item when someone in the car spots it. Finish a list for a stamp.")), confirmEl);
    host.append(h("h3", { class: "sub" }, `Stamp book · ${Object.keys(st.stamps).filter(k => regionById(k)).length} of ${R.length}`), h("ul", { class: "pl-stamps" }, R.map(x => stampEl(x, st.stamps[x.id]))), live);
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
