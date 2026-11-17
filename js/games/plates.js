// Plate Hunt: collect license plates from all 50 states and D.C. (plus Canadian provinces and Mexican states as a bonus).
// A tile map of the US (every state the same size square, not a real map), a searchable list, progress, rare finds.
// Store key "plates": {found: {CODE: [timestamps]}, view: "grid"|"list", scope: "all"|"trip"}. "This trip" counts sightings
// since "playTripAt" (set when a trip ends or the person taps Start a fresh trip). Nothing leaves the phone.

// [code, name, column, row] on the well-known equal-square tile map (12 columns, 8 rows)
export const US = [
  ["AK", "Alaska", 0, 0], ["ME", "Maine", 11, 0],
  ["VT", "Vermont", 10, 1], ["NH", "New Hampshire", 11, 1],
  ["WA", "Washington", 1, 2], ["ID", "Idaho", 2, 2], ["MT", "Montana", 3, 2], ["ND", "North Dakota", 4, 2], ["MN", "Minnesota", 5, 2], ["IL", "Illinois", 6, 2],
  ["WI", "Wisconsin", 7, 2], ["MI", "Michigan", 8, 2], ["NY", "New York", 9, 2], ["RI", "Rhode Island", 10, 2], ["MA", "Massachusetts", 11, 2],
  ["OR", "Oregon", 1, 3], ["NV", "Nevada", 2, 3], ["WY", "Wyoming", 3, 3], ["SD", "South Dakota", 4, 3], ["IA", "Iowa", 5, 3], ["IN", "Indiana", 6, 3],
  ["OH", "Ohio", 7, 3], ["PA", "Pennsylvania", 8, 3], ["NJ", "New Jersey", 9, 3], ["CT", "Connecticut", 10, 3],
  ["CA", "California", 1, 4], ["UT", "Utah", 2, 4], ["CO", "Colorado", 3, 4], ["NE", "Nebraska", 4, 4], ["MO", "Missouri", 5, 4], ["KY", "Kentucky", 6, 4],
  ["WV", "West Virginia", 7, 4], ["VA", "Virginia", 8, 4], ["MD", "Maryland", 9, 4], ["DE", "Delaware", 10, 4],
  ["AZ", "Arizona", 2, 5], ["NM", "New Mexico", 3, 5], ["KS", "Kansas", 4, 5], ["AR", "Arkansas", 5, 5], ["TN", "Tennessee", 6, 5], ["NC", "North Carolina", 7, 5],
  ["SC", "South Carolina", 8, 5], ["DC", "Washington, D.C.", 9, 5],
  ["OK", "Oklahoma", 4, 6], ["LA", "Louisiana", 5, 6], ["MS", "Mississippi", 6, 6], ["AL", "Alabama", 7, 6], ["GA", "Georgia", 8, 6],
  ["HI", "Hawaii", 0, 7], ["TX", "Texas", 4, 7], ["FL", "Florida", 9, 7],
];
export const CANADA = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"], ["NT", "Northwest Territories"],
  ["NS", "Nova Scotia"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
].map(([c, n]) => ["CAN-" + c, n, c]);
export const MEXICO = [
  ["AGU", "Aguascalientes"], ["BCN", "Baja California"], ["BCS", "Baja California Sur"], ["CAM", "Campeche"], ["CHP", "Chiapas"], ["CHH", "Chihuahua"],
  ["CMX", "Mexico City"], ["COA", "Coahuila"], ["COL", "Colima"], ["DUR", "Durango"], ["GUA", "Guanajuato"], ["GRO", "Guerrero"], ["HID", "Hidalgo"], ["JAL", "Jalisco"],
  ["MEX", "State of Mexico"], ["MIC", "Michoacan"], ["MOR", "Morelos"], ["NAY", "Nayarit"], ["NLE", "Nuevo Leon"], ["OAX", "Oaxaca"], ["PUE", "Puebla"], ["QUE", "Queretaro"],
  ["ROO", "Quintana Roo"], ["SLP", "San Luis Potosi"], ["SIN", "Sinaloa"], ["SON", "Sonora"], ["TAB", "Tabasco"], ["TAM", "Tamaulipas"], ["TLA", "Tlaxcala"],
  ["VER", "Veracruz"], ["YUC", "Yucatan"], ["ZAC", "Zacatecas"],
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
    return `${name}${RARE.has(code) ? ", rare find" : ""}, ${f ? `found ${fmtDate(w)}` : before(code) ? "seen on an earlier trip, not this one" : "not found yet"}`;
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
    ctx.announce(on ? `${name} found.` : `${name} taken off the list.`);
    if (on) {
      ctx.chime("success");
      ctx.buzz(25);
      if (RARE.has(code)) rareFind(code);
      else { rare = null; paintRare(); }
      if (!wasComplete && count(US) === US.length) ctx.cheer({ top: "PLATE HUNT", title: "ALL 51", sub: "Every state and D.C.", speak: [ctx.LINES.plates.all, "play:plates:all"] });
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
    ctx.announce(on ? `${name} taken off the list.` : `${name} is back on the list.`);
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
    ctx.announce("Every plate is back on the list.");
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
      h("div", { class: "pl-pl-big" }, el.count, h("span", null, "plates found")),
      el.bar,
      h("p", { class: "pl-pl-sub" }));
    const scopeSeg = h("div", { class: "seg wide pl-pl-seg", role: "group", "aria-label": "Count plates from" },
      ...[["all", "All time"], ["trip", "This trip"]].map(([id, t]) => h("button", { type: "button", "data-scope": id, "aria-pressed": String(st.scope === id),
        onclick: safe(() => { st.scope = id; save(); paint(); }, "scope") }, t)));
    const viewSeg = h("div", { class: "seg wide pl-pl-seg", role: "group", "aria-label": "How to show the states" },
      ...[["grid", "Map", "grid"], ["list", "List", "list"]].map(([id, t, ic]) => h("button", { type: "button", "data-view": id, "aria-pressed": String(st.view === id),
        onclick: safe(() => { st.view = id; save(); paint(); }, "view") }, icon(ic, "pl-ic pl-seg-ic"), t)));
    el.rare = h("div", { class: "pl-rare", hidden: true, role: "status" });
    el.readout = h("div", { class: "pl-pl-read" });
    el.grid = h("div", { class: "pl-tiles", role: "group", "aria-label": "Plates by state" });
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
      h("summary", null, h("span", null, "Bonus plates"), h("small", { class: "pl-bonus-n" })),
      h("h4", { class: "sub" }, "Canada"), chipList(CANADA), h("h4", { class: "sub" }, "Mexico"), chipList(MEXICO));
    // list view
    const search = h("input", { class: "pl-search", type: "search", placeholder: "Search states and provinces", "aria-label": "Search plates", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
      oninput: safe(e => { q = e.target.value; drawList(); }, "search") });
    const filt = h("div", { class: "seg wide pl-pl-seg", role: "group", "aria-label": "Show" },
      ...[["all", "All"], ["found", "Found"], ["todo", "To find"]].map(([id, t]) => h("button", { type: "button", "data-f": id, "aria-pressed": String(filter === id),
        onclick: safe(() => { filter = id; for (const b of filt.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.f === id)); drawList(); }, "filter") }, t)));
    el.listBody = h("div", { class: "pl-plist" });
    el.list = h("div", { class: "pl-listview" }, h("div", { class: "pl-searchrow" }, icon("search", "pl-ic pl-search-ic"), search), filt, el.listBody);
    // footer
    el.confirm = h("div", { class: "pl-confirm", hidden: true, role: "group", "aria-label": "Clear every plate?" },
      h("p", null, "Take every plate off the list? This clears all trips."),
      h("div", { class: "pl-row" },
        h("button", { class: "secondary", type: "button", "data-k": "keep", onclick: () => { el.confirm.hidden = true; host.querySelector('[data-k="reset"]').focus({ preventScroll: true }); } }, "Keep them"),
        h("button", { class: "primary", type: "button", "data-k": "reset-yes", onclick: safe(() => { el.confirm.hidden = true; reset(); }, "reset yes") }, "Clear all")));
    const foot = h("div", { class: "pl-row pl-pl-foot" },
      h("button", { class: "secondary", type: "button", "data-k": "trip", onclick: safe(() => { ctx.newTrip(); ctx.toast("A new trip begins. This trip's plates start from zero."); }, "new trip") }, "Start a fresh trip"),
      h("button", { class: "secondary", type: "button", "data-k": "reset", onclick: safe(() => {
        if (!Object.keys(st.found).length) return;
        el.confirm.hidden = false; el.confirm.querySelector("button.secondary").focus({ preventScroll: true });
        try { el.confirm.scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }
      }, "reset") }, "Reset all plates"));
    host.append(el.stats, h("div", { class: "pl-pl-seg2" }, scopeSeg, viewSeg), el.rare,
      h("div", { class: "pl-mapview" }, el.grid, el.readout, h("p", { class: "pl-pl-how" }, "Tap a state when you spot its plate. Tap again to take it off."), el.bonus),
      el.list, foot, el.confirm, live);
    paint();
  }

  function readout(code) {
    if (!el.readout) return;
    const name = nameOf(code), f = isFound(code), w = when(code);
    el.readout.textContent = "";
    el.readout.append(
      h("span", { class: "pl-ro-t" }, h("b", null, name), h("small", null, f ? `Found ${fmtDate(w)}` : "Off the list")),
      last && last.code === code ? h("button", { class: "link pl-undo", type: "button", "data-k": "undo", "aria-label": `Undo ${name}`, onclick: safe(() => { undo(); el.readout.textContent = ""; }, "undo") }, icon("undo", "pl-ic"), "Undo") : null);
  }
  function paintRare() {
    if (!el.rare) return;
    el.rare.hidden = !rare;
    el.rare.textContent = "";
    if (!rare) return;
    const name = nameOf(rare.code);
    el.rare.append(icon("star", "pl-ic pl-rare-star"), h("div", null, h("b", null, `Rare find: ${name}`), h("small", null, "Not many of these cross the road. Nice spotting.")));
  }

  function paint(code, fresh) {
    const n = count(US), total = US.length;
    el.count.textContent = `${n} of ${total}`;
    el.barI.style.width = `${Math.round(n / total * 100)}%`;
    el.bar.setAttribute("aria-label", `${n} of ${total} states found`);
    const sub = el.stats.querySelector(".pl-pl-sub");
    const bonus = count(CANADA) + count(MEXICO);
    sub.textContent = [st.scope === "trip" ? "On this trip" : "Across every trip", bonus ? `${bonus} bonus ${bonus === 1 ? "plate" : "plates"}` : ""].filter(Boolean).join(" · ");
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
    el.bonus.querySelector(".pl-bonus-n").textContent = `${bonus} of ${CANADA.length + MEXICO.length}`;
    if (st.view === "list") drawList(code);
    paintRare();
  }

  function drawList(freshCode) {
    const needle = fold(q.trim());
    const body = el.listBody;
    const focus = body.contains(document.activeElement) ? document.activeElement.getAttribute("data-c") : null;
    body.textContent = "";
    refs.rows.clear();
    const groups = [["United States", US], ["Canada", CANADA], ["Mexico", MEXICO]];
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
      body.append(h("h4", { class: "sub" }, `${title} · ${count(list)} of ${list.length}`));
      const ul = h("ul", { class: "pl-prow-list" });
      for (const s of rows) {
        const code = s[0], f = isFound(code);
        const b = h("button", { class: "pl-lrow" + (f ? " on" : "") + (before(code) ? " before" : "") + (code === freshCode ? " fresh" : ""), type: "button", "data-c": code, "aria-pressed": String(f),
          "aria-label": label(code, s[1]), onclick: safe(() => { toggle(code); }, "row " + code) },
          h("span", { class: "pl-lcode", "aria-hidden": "true" }, s[2] || s[0]),
          h("span", { class: "pl-lname", "aria-hidden": "true" }, h("b", null, s[1]), h("small", null, f ? `Found ${fmtDate(when(code))}` : before(code) ? "Seen on an earlier trip" : RARE.has(code) ? "A rare find" : "Not yet")),
          h("span", { class: "pl-lcheck", "aria-hidden": "true" }, f ? icon("check", "pl-ic") : null));
        refs.rows.set(code, b);
        ul.append(h("li", null, b));
      }
      body.append(ul);
    }
    if (!shown) body.append(h("p", { class: "pl-none" }, needle ? "No plate matches that search." : filter === "found" ? "Nothing found yet. Tap a state when you spot its plate." : "Every plate is found. That is a full set."));
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
