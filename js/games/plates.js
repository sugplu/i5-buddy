// Plate Hunt: collect license plates from all 50 states and D.C. (plus Canadian provinces and Mexican states as a bonus).
// A tile map of the US (every state the same size square, not a real map), a searchable list, progress, rare finds.
// Store key "plates": {found: {CODE: [timestamps]}, view: "grid"|"list", scope: "all"|"trip"}. "This trip" counts sightings
// since "playTripAt" (set when a trip ends or the person taps Start a fresh trip). Nothing leaves the phone.

// [code, name, column, row] on the well-known equal-square tile map (12 columns, 8 rows)
import { t } from "../i18n.js";
export const US = [
  ["AK", t("games.plates.alaska"), 0, 0], ["ME", t("games.plates.maine"), 11, 0],
  ["VT", t("games.plates.vermont"), 10, 1], ["NH", t("games.plates.new_hampshire"), 11, 1],
  ["WA", t("games.plates.washington"), 1, 2], ["ID", t("games.plates.idaho"), 2, 2], ["MT", t("games.plates.montana"), 3, 2], ["ND", t("games.plates.north_dakota"), 4, 2], ["MN", t("games.plates.minnesota"), 5, 2], ["IL", t("games.plates.illinois"), 6, 2],
  ["WI", t("games.plates.wisconsin"), 7, 2], ["MI", t("games.plates.michigan"), 8, 2], ["NY", t("games.plates.new_york"), 9, 2], ["RI", t("games.plates.rhode_island"), 10, 2], ["MA", t("games.plates.massachusetts"), 11, 2],
  ["OR", t("games.plates.oregon"), 1, 3], ["NV", t("games.plates.nevada"), 2, 3], ["WY", t("games.plates.wyoming"), 3, 3], ["SD", t("games.plates.south_dakota"), 4, 3], ["IA", t("games.plates.iowa"), 5, 3], ["IN", t("games.plates.indiana"), 6, 3],
  ["OH", t("games.plates.ohio"), 7, 3], ["PA", t("games.plates.pennsylvania"), 8, 3], ["NJ", t("games.plates.new_jersey"), 9, 3], ["CT", t("games.plates.connecticut"), 10, 3],
  ["CA", t("games.plates.california"), 1, 4], ["UT", t("games.plates.utah"), 2, 4], ["CO", t("games.plates.colorado"), 3, 4], ["NE", t("games.plates.nebraska"), 4, 4], ["MO", t("games.plates.missouri"), 5, 4], ["KY", t("games.plates.kentucky"), 6, 4],
  ["WV", t("games.plates.west_virginia"), 7, 4], ["VA", t("games.plates.virginia"), 8, 4], ["MD", t("games.plates.maryland"), 9, 4], ["DE", t("games.plates.delaware"), 10, 4],
  ["AZ", t("games.plates.arizona"), 2, 5], ["NM", t("games.plates.new_mexico"), 3, 5], ["KS", t("games.plates.kansas"), 4, 5], ["AR", t("games.plates.arkansas"), 5, 5], ["TN", t("games.plates.tennessee"), 6, 5], ["NC", t("games.plates.north_carolina"), 7, 5],
  ["SC", t("games.plates.south_carolina"), 8, 5], ["DC", t("games.plates.washington_d_c"), 9, 5],
  ["OK", t("games.plates.oklahoma"), 4, 6], ["LA", t("games.plates.louisiana"), 5, 6], ["MS", t("games.plates.mississippi"), 6, 6], ["AL", t("games.plates.alabama"), 7, 6], ["GA", t("games.plates.georgia"), 8, 6],
  ["HI", t("games.plates.hawaii"), 0, 7], ["TX", t("games.plates.texas"), 4, 7], ["FL", t("games.plates.florida"), 9, 7],
];
export const CANADA = [
  ["AB", t("games.plates.alberta")], ["BC", t("games.plates.british_columbia")], ["MB", t("games.plates.manitoba")], ["NB", t("games.plates.new_brunswick")], ["NL", t("games.plates.newfoundland_and_labrador")], ["NT", t("games.plates.northwest_territories")],
  ["NS", t("games.plates.nova_scotia")], ["NU", t("games.plates.nunavut")], ["ON", t("games.plates.ontario")], ["PE", t("games.plates.prince_edward_island")], ["QC", t("games.plates.quebec")], ["SK", t("games.plates.saskatchewan")], ["YT", t("games.plates.yukon")],
].map(([c, n]) => ["CAN-" + c, n, c]);
export const MEXICO = [
  ["AGU", t("games.plates.aguascalientes")], ["BCN", t("games.plates.baja_california")], ["BCS", t("games.plates.baja_california_sur")], ["CAM", t("games.plates.campeche")], ["CHP", t("games.plates.chiapas")], ["CHH", t("games.plates.chihuahua")],
  ["CMX", t("games.plates.mexico_city")], ["COA", t("games.plates.coahuila")], ["COL", t("games.plates.colima")], ["DUR", t("games.plates.durango")], ["GUA", t("games.plates.guanajuato")], ["GRO", t("games.plates.guerrero")], ["HID", t("games.plates.hidalgo")], ["JAL", t("games.plates.jalisco")],
  ["MEX", t("games.plates.state_of_mexico")], ["MIC", t("games.plates.michoacan")], ["MOR", t("games.plates.morelos")], ["NAY", t("games.plates.nayarit")], ["NLE", t("games.plates.nuevo_leon")], ["OAX", t("games.plates.oaxaca")], ["PUE", t("games.plates.puebla")], ["QUE", t("games.plates.queretaro")],
  ["ROO", t("games.plates.quintana_roo")], ["SLP", t("games.plates.san_luis_potosi")], ["SIN", t("games.plates.sinaloa")], ["SON", t("games.plates.sonora")], ["TAB", t("games.plates.tabasco")], ["TAM", t("games.plates.tamaulipas")], ["TLA", t("games.plates.tlaxcala")],
  ["VER", t("games.plates.veracruz")], ["YUC", t("games.plates.yucatan")], ["ZAC", t("games.plates.zacatecas")],
].map(([c, n]) => ["MX-" + c, n, c]);
export const RARE = new Set(["HI", "AK"]);

const ALL = new Map([...US.map(s => [s[0], s[1]]), ...CANADA.map(s => [s[0], s[1]]), ...MEXICO.map(s => [s[0], s[1]])]);
const fold = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function create(ctx) {
  const { h, icon, safe, fmtDate } = ctx;
  const host = ctx.pane;
  let st = load();
  let last = null;            // the last change, for Undo: {code, prev: [timestamps], name, on}
  let q = "", filter = "all"; // list view
  let rare = null;            // the rare-find card on screen: {code}
  const live = h("p", { class: "pl-sr", role: "status" });
  const refs = { tiles: new Map(), rows: new Map(), chips: new Map() };

  function load() {
    const r = ctx.store("plates", null);
    const o = r && typeof r === "object" ? r : {};
    const found = {};
    for (const [code, arr] of Object.entries(o.found && typeof o.found === "object" ? o.found : {})) {
      if (!ALL.has(code) || !Array.isArray(arr)) continue;
      const a = arr.filter(t => typeof t === "number" && isFinite(t)).sort((x, y) => x - y);
      if (a.length) found[code] = a;
    }
    return { found, view: o.view === "list" ? "list" : "grid", scope: o.scope === "trip" ? "trip" : "all" };
  }
  const save = () => ctx.save("plates", st);
  const tripAt = () => ctx.tripAt();
  const times = code => st.found[code] || [];
  const isFound = code => (st.scope === "trip" ? times(code).some(t => t >= tripAt()) : times(code).length > 0);
  const before = code => st.scope === "trip" && times(code).length > 0 && !isFound(code);
  const when = code => { const a = st.scope === "trip" ? times(code).filter(t => t >= tripAt()) : times(code); return a.length ? a[st.scope === "trip" ? a.length - 1 : 0] : null; };
  const count = list => list.filter(s => isFound(s[0])).length;
  const nameOf = code => ALL.get(code) || code;
  const label = (code, name) => {
    const f = isFound(code), w = when(code);
    return `${name}${RARE.has(code) ? t("games.plates.rare_find") : ""}, ${f ? t("games.plates.found_w", { w: fmtDate(w) }) : before(code) ? t("games.plates.seen_on_an_earlier_trip_not_this_one") : t("games.plates.not_found_yet")}`;
  };

  /* ---------- changing what is found ---------- */
  function toggle(code) {
    if (!ALL.has(code)) return false;
    const prev = times(code).slice();
    const wasComplete = count(US) === US.length;
    const name = nameOf(code);
    let on;
    if (isFound(code)) { on = false; const keep = st.scope === "trip" ? prev.filter(t => t < tripAt()) : []; if (keep.length) st.found[code] = keep; else delete st.found[code]; }
    else { on = true; st.found[code] = [...prev, Date.now()]; }
    last = { code, prev, name, on };
    save();
    paint(code, on);
    ctx.announce(on ? t("games.plates.name_found", { name }) : t("games.plates.name_taken_off_the_list", { name }));
    if (on) {
      ctx.chime("success");
      ctx.buzz(25);
      if (RARE.has(code)) rareFind(code);
      else { rare = null; paintRare(); }
      if (!wasComplete && count(US) === US.length) ctx.cheer({ top: t("games.plates.plate_hunt"), title: "ALL 51", sub: t("games.plates.every_state_and_d_c"), speak: [ctx.LINES.plates.all, "play:plates:all"] });
    } else { rare = null; paintRare(); }
    return on;
  }
  function undo() {
    if (!last) return;
    const { code, prev, name, on } = last;
    if (prev.length) st.found[code] = prev; else delete st.found[code];
    last = null;
    save();
    paint(code, false);
    rare = null; paintRare();
    ctx.announce(on ? t("games.plates.name_taken_off_the_list", { name }) : t("games.plates.name_is_back_on_the_list", { name }));
  }
  function rareFind(code) {
    rare = { code };
    paintRare();
    ctx.autoSay(ctx.LINES.plates.rare[code], "play:plates:rare:" + code);
  }
  function reset() {
    st.found = {}; last = null; rare = null;
    save();
    paint();
    ctx.announce(t("games.plates.every_plate_is_back_on_the_list"));
  }

  /* ---------- drawing ---------- */
  const el = { stats: null, count: null, bar: null, barI: null, trip: null, readout: null, rare: null, bonus: null, grid: null, list: null, listBody: null, confirm: null };

  function build() {
    host.textContent = "";
    refs.tiles.clear(); refs.rows.clear(); refs.chips.clear();
    el.count = h("b", { class: "pl-pl-n" });
    el.barI = h("i");
    el.bar = h("div", { class: "pl-pl-bar", role: "img" }, el.barI);
    el.stats = h("div", { class: "pl-pl-stats" },
      h("div", { class: "pl-pl-big" }, el.count, h("span", null, t("games.plates.plates_found"))),
      el.bar,
      h("p", { class: "pl-pl-sub" }));
    const scopeSeg = h("div", { class: "seg wide pl-pl-seg", role: "group", "aria-label": t("games.plates.count_plates_from") },
      ...[["all", t("games.plates.all_time")], ["trip", t("games.plates.this_trip")]].map(([id, t]) => h("button", { type: "button", "data-scope": id, "aria-pressed": String(st.scope === id),
        onclick: safe(() => { st.scope = id; save(); paint(); }, "scope") }, t)));
    const viewSeg = h("div", { class: "seg wide pl-pl-seg", role: "group", "aria-label": t("games.plates.how_to_show_the_states") },
      ...[["grid", t("games.plates.map"), "grid"], ["list", t("games.plates.list"), "list"]].map(([id, t, ic]) => h("button", { type: "button", "data-view": id, "aria-pressed": String(st.view === id),
        onclick: safe(() => { st.view = id; save(); paint(); }, "view") }, icon(ic, "pl-ic pl-seg-ic"), t)));
    el.rare = h("div", { class: "pl-rare", hidden: true, role: "status" });
    el.readout = h("div", { class: "pl-pl-read" });
    el.grid = h("div", { class: "pl-tiles", role: "group", "aria-label": t("games.plates.plates_by_state") });
    for (const [code, name, col, row] of US) {
      const b = h("button", { class: "pl-tile" + (RARE.has(code) ? " rare" : ""), type: "button", "data-c": code, style: `grid-column:${col + 1};grid-row:${row + 1}`, "aria-pressed": "false",
        onclick: safe(() => { toggle(code); readout(code); }, "tile " + code) }, h("span", null, code), RARE.has(code) ? h("i", { class: "pl-tile-star", "aria-hidden": "true" }) : null);
      refs.tiles.set(code, b);
      el.grid.append(b);
    }
    // bonus: Canada and Mexico
    const chipList = list => h("div", { class: "pl-chips" }, list.map(([code, name, short]) => {
      const b = h("button", { class: "pl-chip2", type: "button", "data-c": code, "aria-pressed": "false", onclick: safe(() => toggle(code), "chip " + code) },
        h("b", null, short), h("span", null, name));
      refs.chips.set(code, b);
      return b;
    }));
    el.bonus = h("details", { class: "pl-bonus" },
      h("summary", null, h("span", null, t("games.plates.bonus_plates")), h("small", { class: "pl-bonus-n" })),
      h("h4", { class: "sub" }, t("games.plates.canada")), chipList(CANADA), h("h4", { class: "sub" }, t("games.plates.mexico")), chipList(MEXICO));
    // list view
    const search = h("input", { class: "pl-search", type: "search", placeholder: t("games.plates.search_states_and_provinces"), "aria-label": t("games.plates.search_plates"), autocomplete: "off", autocapitalize: "off", spellcheck: "false",
      oninput: safe(e => { q = e.target.value; drawList(); }, "search") });
    const filt = h("div", { class: "seg wide pl-pl-seg", role: "group", "aria-label": t("games.plates.show") },
      ...[["all", t("games.plates.all")], ["found", t("games.plates.found")], ["todo", t("games.plates.to_find")]].map(([id, t]) => h("button", { type: "button", "data-f": id, "aria-pressed": String(filter === id),
        onclick: safe(() => { filter = id; for (const b of filt.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.f === id)); drawList(); }, "filter") }, t)));
    el.listBody = h("div", { class: "pl-plist" });
    el.list = h("div", { class: "pl-listview" }, h("div", { class: "pl-searchrow" }, icon("search", "pl-ic pl-search-ic"), search), filt, el.listBody);
    // footer
    el.confirm = h("div", { class: "pl-confirm", hidden: true, role: "group", "aria-label": t("games.plates.clear_every_plate") },
      h("p", null, t("games.plates.take_every_plate_off_the_list_this")),
      h("div", { class: "pl-row" },
        h("button", { class: "secondary", type: "button", "data-k": "keep", onclick: () => { el.confirm.hidden = true; host.querySelector('[data-k="reset"]').focus({ preventScroll: true }); } }, t("games.plates.keep_them")),
        h("button", { class: "primary", type: "button", "data-k": "reset-yes", onclick: safe(() => { el.confirm.hidden = true; reset(); }, "reset yes") }, t("games.plates.clear_all"))));
    const foot = h("div", { class: "pl-row pl-pl-foot" },
      h("button", { class: "secondary", type: "button", "data-k": "trip", onclick: safe(() => { ctx.newTrip(); ctx.toast(t("games.plates.a_new_trip_begins_this_trips_plates")); }, "new trip") }, t("games.plates.start_a_fresh_trip")),
      h("button", { class: "secondary", type: "button", "data-k": "reset", onclick: safe(() => {
        if (!Object.keys(st.found).length) return;
        el.confirm.hidden = false; el.confirm.querySelector("button.secondary").focus({ preventScroll: true });
        try { el.confirm.scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }
      }, "reset") }, t("games.plates.reset_all_plates")));
    host.append(el.stats, h("div", { class: "pl-pl-seg2" }, scopeSeg, viewSeg), el.rare,
      h("div", { class: "pl-mapview" }, el.grid, el.readout, h("p", { class: "pl-pl-how" }, t("games.plates.tap_a_state_when_you_spot_its_plate")), el.bonus),
      el.list, foot, el.confirm, live);
    paint();
  }

  function readout(code) {
    if (!el.readout) return;
    const name = nameOf(code), f = isFound(code), w = when(code);
    el.readout.textContent = "";
    el.readout.append(
      h("span", { class: "pl-ro-t" }, h("b", null, name), h("small", null, f ? t("games.plates.found_w_2", { w: fmtDate(w) }) : t("games.plates.off_the_list"))),
      last && last.code === code ? h("button", { class: "link pl-undo", type: "button", "data-k": "undo", "aria-label": t("games.plates.undo_name", { name }), onclick: safe(() => { undo(); el.readout.textContent = ""; }, "undo") }, icon("undo", "pl-ic"), t("games.plates.undo")) : null);
  }
  function paintRare() {
    if (!el.rare) return;
    el.rare.hidden = !rare;
    el.rare.textContent = "";
    if (!rare) return;
    const name = nameOf(rare.code);
    el.rare.append(icon("star", "pl-ic pl-rare-star"), h("div", null, h("b", null, t("games.plates.rare_find_name", { name })), h("small", null, t("games.plates.not_many_of_these_cross_the_road_nice"))));
  }

  function paint(code, fresh) {
    const n = count(US), total = US.length;
    el.count.textContent = t("games.plates.n_of_total", { n, total });
    el.barI.style.width = `${Math.round(n / total * 100)}%`;
    el.bar.setAttribute("aria-label", t("games.plates.n_of_total_states_found", { n, total }));
    const sub = el.stats.querySelector(".pl-pl-sub");
    const bonus = count(CANADA) + count(MEXICO);
    sub.textContent = [st.scope === "trip" ? t("games.plates.on_this_trip") : t("games.plates.across_every_trip"), bonus ? t("games.plates.bonus_bonus_x1", { bonus, x1: bonus === 1 ? t("games.plates.plate") : t("games.plates.plates") }) : ""].filter(Boolean).join(" · ");
    for (const b of host.querySelectorAll("[data-scope]")) b.setAttribute("aria-pressed", String(b.dataset.scope === st.scope));
    for (const b of host.querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === st.view));
    host.querySelector(".pl-mapview").hidden = st.view !== "grid";
    el.list.hidden = st.view !== "list";
    for (const [c, b] of refs.tiles) {
      const f = isFound(c);
      b.classList.toggle("on", f);
      b.classList.toggle("before", before(c));
      b.setAttribute("aria-pressed", String(f));
      b.setAttribute("aria-label", label(c, nameOf(c)));
      b.title = nameOf(c);
      if (c === code && fresh) { b.classList.remove("fresh"); void b.offsetWidth; b.classList.add("fresh"); }
    }
    for (const [c, b] of refs.chips) {
      const f = isFound(c);
      b.classList.toggle("on", f);
      b.classList.toggle("before", before(c));
      b.setAttribute("aria-pressed", String(f));
      b.setAttribute("aria-label", label(c, nameOf(c)));
    }
    el.bonus.querySelector(".pl-bonus-n").textContent = t("games.plates.bonus_of_x1", { bonus, x1: CANADA.length + MEXICO.length });
    if (st.view === "list") drawList(code);
    paintRare();
  }

  function drawList(freshCode) {
    const needle = fold(q.trim());
    const body = el.listBody;
    const focus = body.contains(document.activeElement) ? document.activeElement.getAttribute("data-c") : null;
    body.textContent = "";
    refs.rows.clear();
    const groups = [[t("games.plates.united_states"), US], [t("games.plates.canada"), CANADA], [t("games.plates.mexico"), MEXICO]];
    let shown = 0;
    for (const [title, list] of groups) {
      const rows = list.filter(s => {
        const code = s[0];
        if (filter === "found" && !isFound(code)) return false;
        if (filter === "todo" && isFound(code)) return false;
        return !needle || fold(s[1]).includes(needle) || fold(s[2] || s[0]).includes(needle);
      }).sort((a, b) => a[1].localeCompare(b[1]));
      if (!rows.length) continue;
      shown += rows.length;
      body.append(h("h4", { class: "sub" }, t("games.plates.title_list_of_length", { title, list: count(list), length: list.length })));
      const ul = h("ul", { class: "pl-prow-list" });
      for (const s of rows) {
        const code = s[0], f = isFound(code);
        const b = h("button", { class: "pl-lrow" + (f ? " on" : "") + (before(code) ? " before" : "") + (code === freshCode ? " fresh" : ""), type: "button", "data-c": code, "aria-pressed": String(f),
          "aria-label": label(code, s[1]), onclick: safe(() => { toggle(code); }, "row " + code) },
          h("span", { class: "pl-lcode", "aria-hidden": "true" }, s[2] || s[0]),
          h("span", { class: "pl-lname", "aria-hidden": "true" }, h("b", null, s[1]), h("small", null, f ? t("games.plates.found_fmtdate", { fmtDate: fmtDate(when(code)) }) : before(code) ? t("games.plates.seen_on_an_earlier_trip") : RARE.has(code) ? t("games.plates.a_rare_find") : t("games.plates.not_yet"))),
          h("span", { class: "pl-lcheck", "aria-hidden": "true" }, f ? icon("check", "pl-ic") : null));
        refs.rows.set(code, b);
        ul.append(h("li", null, b));
      }
      body.append(ul);
    }
    if (!shown) body.append(h("p", { class: "pl-none" }, needle ? t("games.plates.no_plate_matches_that_search") : filter === "found" ? t("games.plates.nothing_found_yet_tap_a_state_when_you") : t("games.plates.every_plate_is_found_that_is_a_full")));
    if (focus) { const b = refs.rows.get(focus); b && b.focus({ preventScroll: true }); }
  }

  build();
  return {
    show() { paint(); },
    hide() {},
    tripChanged() { last = null; rare = null; paint(); },
    toggle,
    state: () => ({ found: JSON.parse(JSON.stringify(st.found)), view: st.view, scope: st.scope, n: count(US), bonus: count(CANADA) + count(MEXICO), total: US.length }),
  };
}
