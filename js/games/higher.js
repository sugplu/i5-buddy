// Higher or Lower: a streak game built only from numbers already in the app's data.
//   Elevation        ELEV at a landmark's corridor mile ("how high is I-5 near here")
//   Road order       corridor miles of landmarks (which is farther north)
//   Distance         miles apart on I-5 between two cities in DESTS
//   Missions         the founding year of each of the 21 missions (MISSIONS.founded)
// Store key "higher": {best, bests: {mode: n}, mode, games}.
// A pair is never a tie and never so close that the answer is a coin flip (see OK below).

const MODES = [["mix", "Mix"], ["elev", "Elevation"], ["north", "Road order"], ["dist", "Distance"], ["mission", "Missions"]];
const CAT_LABEL = { elev: "I-5 near", north: "On I-5", dist: "Between", mission: "Founded" };
const OK = {   // the smallest difference that makes a fair question
  elev: (a, b) => Math.abs(a.v - b.v) >= 60 && Math.abs(a.m - b.m) >= 6,
  north: (a, b) => Math.abs(a.v - b.v) >= 8,
  dist: (a, b) => Math.abs(a.v - b.v) >= 20 && a.key !== b.key,
  mission: (a, b) => a.v !== b.v,
};
const cap1 = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function create(ctx) {
  const { h, icon, safe, shortName, thousands, pick } = ctx;
  const host = ctx.pane;
  const D = () => ctx.D();
  const rec0 = () => { const r = ctx.store("higher", null); return r && typeof r === "object" ? r : {}; };
  let rec = { best: Math.max(0, ctx.num(rec0().best)), bests: rec0().bests && typeof rec0().bests === "object" ? { ...rec0().bests } : {}, mode: rec0().mode, games: Math.max(0, ctx.num(rec0().games)) };
  const saveRec = () => ctx.save("higher", rec);
  let g = { mode: MODES.some(m => m[0] === rec.mode) ? rec.mode : "mix", phase: "ask", cat: null, known: null, hidden: null, streak: 0, newBest: false, ok: null, lastCat: null, stop: null };
  const live = h("p", { class: "pl-sr", role: "status" });
  let strip = null;
  let el = {};

  /* ---------- the items (all from the app's data) ---------- */
  const places = () => (Array.isArray(D().PLACES) ? D().PLACES : []).filter(p => p && !p.detour && isFinite(p.m) && p.name && shortName(p).length <= 34);
  // the road's own height at a mile differs a little from a height a landmark's text quotes: leave those landmarks out
  const quotes = p => /(\d[\d,]*) (feet|ft)\b/.test(`${p.text || ""} ${p.more || ""}`) && /(elevation|summit|reaches|highest|high point|top of)/i.test(`${p.name} ${p.text || ""}`);
  const elevOf = m => { try { const v = D().elevAt ? D().elevAt(m) : (D().ELEV ? D().ELEV[Math.round(m)] : null); return Number.isFinite(v) ? v : null; } catch { return null; } };
  const dests = () => (Array.isArray(D().DESTS) ? D().DESTS : []).filter(d => d && d.name && isFinite(d.m));
  const missions = () => (Array.isArray(D().MISSIONS) ? D().MISSIONS : []).filter(x => x && x.name && /^\d{4}/.test(String(x.founded || "")));
  const have = {
    elev: () => places().length >= 8 && Array.isArray(D().ELEV) && D().ELEV.length > 10,
    north: () => places().length >= 8,
    dist: () => dests().length >= 4,
    mission: () => missions().length >= 4,
  };
  const cats = () => ["elev", "north", "dist", "mission"].filter(c => have[c]());

  function placeItem(cat) {
    const all = places();
    const withImg = all.filter(p => p.img && p.img.f);
    for (let t = 0; t < 30; t++) {
      const pool = withImg.length && Math.random() < 0.75 ? withImg : all;
      const p = pick(pool);
      if (cat === "elev") {
        if (quotes(p)) continue;
        const v = elevOf(p.m);
        if (v == null) continue;
        return { cat, id: p.id, key: p.id, name: shortName(p), place: p, m: p.m, v, sub: ctx.mileLabel(p.m) ? cap1(ctx.mileLabel(p.m)) : "" };
      }
      return { cat, id: p.id, key: p.id, name: shortName(p), place: p, m: p.m, v: Math.round(p.m), sub: p.cat ? (D().CATS && D().CATS[p.cat]) || "" : "" };
    }
    return null;
  }
  function distItem() {
    const d = dests();
    for (let t = 0; t < 30; t++) {
      const a = pick(d), b = pick(d);
      if (a.name === b.name || Math.abs(a.m - b.m) < 10) continue;
      const lo = a.m < b.m ? a : b, hi = a.m < b.m ? b : a;
      return { cat: "dist", id: `${lo.name}|${hi.name}`, key: `${lo.name}|${hi.name}`, name: `${lo.name} to ${hi.name}`, m: Math.round(hi.m - lo.m), v: Math.round(hi.m - lo.m), sub: "Along I-5", pair: [lo.name, hi.name] };
    }
    return null;
  }
  function missionItem() {
    const list = missions(), x = pick(list);
    const place = (Array.isArray(D().PLACES) ? D().PLACES : []).find(p => p && p.mission === x.n && p.img && p.img.f) || null;
    return { cat: "mission", id: x.id || String(x.n), key: String(x.n), name: x.name, place, m: 0, v: parseInt(String(x.founded).slice(0, 4), 10), sub: `Mission number ${x.n} of ${list.length}` };
  }
  const makeItem = cat => (cat === "dist" ? distItem() : cat === "mission" ? missionItem() : placeItem(cat));

  /* ---------- how a number reads ---------- */
  const fmtV = it => (it.cat === "elev" ? thousands(it.v) : it.cat === "north" ? `Mile ${thousands(it.v)}` : it.cat === "dist" ? thousands(it.v) : String(it.v));
  const unitOf = it => (it.cat === "elev" ? "feet, about" : it.cat === "north" ? "from the Mexico border" : it.cat === "dist" ? "miles apart" : "year founded");
  const andName = it => (it.pair ? it.pair.join(" and ") : it.name);
  const askOf = (a, b) => ({
    elev: [`Is I-5 higher or lower near ${b.name} than near ${a.name}?`, "Higher", "Lower"],
    north: [`Is ${b.name} farther north or farther south than ${a.name}?`, "Farther north", "Farther south"],
    dist: [`Are ${andName(b)} farther apart or closer together than ${andName(a)}?`, "Farther apart", "Closer together"],
    mission: [`Was ${b.name} founded later or earlier than ${a.name}?`, "Later", "Earlier"],
  })[a.cat];
  /** The answer in a full sentence, with the number. */
  const fullSentence = (c, b) => {
    const up = b.v > c.v;
    switch (b.cat) {
      case "elev": return `Near ${b.name}, I-5 is about ${thousands(b.v)} feet up, ${up ? "higher" : "lower"} than near ${c.name}.`;
      case "north": return `${b.name} is at mile ${thousands(b.v)}, ${up ? "farther north" : "farther south"} than ${c.name}.`;
      case "dist": return `${b.name} is ${thousands(b.v)} miles on I-5, ${up ? "longer" : "shorter"} than ${c.name}.`;
      default: return `${b.name} was founded in ${b.v}, ${up ? "later" : "earlier"} than ${c.name}.`;
    }
  };

  /* ---------- a round ---------- */
  function chooseCat() {
    const list = cats();
    if (!list.length) return null;
    if (g.mode !== "mix") return list.includes(g.mode) ? g.mode : list[0];
    const pool = list.length > 1 ? list.filter(c => c !== g.lastCat) : list;
    return pick(pool);
  }
  function deal(keepKnown = true) {
    const cat = chooseCat();
    if (!cat) { g.phase = "none"; return false; }
    for (let outer = 0; outer < 6; outer++) {
      let known = keepKnown && g.hidden && g.hidden.cat === cat ? g.hidden : null;
      if (!known) known = makeItem(cat);
      if (!known) continue;
      for (let t = 0; t < 60; t++) {
        const b = makeItem(cat);
        if (b && b.key !== known.key && OK[cat](known, b)) {
          g.cat = cat; g.lastCat = cat; g.known = known; g.hidden = b; g.phase = "ask"; g.ok = null;
          g.correct = b.v > known.v ? "up" : "down";
          return true;
        }
      }
      g.hidden = null;
    }
    g.phase = "none";
    return false;
  }

  function answer(dir) {
    if (g.phase !== "ask" || (dir !== "up" && dir !== "down")) return null;
    const ok = dir === g.correct;
    g.ok = ok;
    g.phase = "reveal";
    const cp = ctx.party && ctx.party.active() ? ctx.party.current() : null;
    if (ok) {
      if (cp) ctx.party.award(1);
      else {
        g.streak++;
        if (g.streak > (rec.bests[g.mode] || 0)) rec.bests[g.mode] = g.streak;
        if (g.streak > rec.best) { rec.best = g.streak; g.newBest = g.streak >= 3; }
      }
      ctx.chime("success");
      ctx.buzz(30);
    } else {
      ctx.buzz([50, 40, 50]);
      if (!cp) { g.phase = "over"; rec.games++; }
    }
    if (!cp || ok) saveRec();
    render(true);
    ctx.announce(`${ok ? ctx.LINES.hol.right : ctx.LINES.hol.wrong} ${fullSentence(g.known, g.hidden)}`);
    ctx.autoSay(ok ? ctx.LINES.hol.right : ctx.LINES.hol.wrong, "play:higher:" + (ok ? "right" : "wrong"));
    if (ok && g.newBest && !cp) ctx.autoSay(ctx.LINES.hol.best, "play:higher:best");
    return ok;
  }
  function next() {
    if (g.phase === "reveal" || g.phase === "over" || g.phase === "none") {
      const cp = ctx.party && ctx.party.active();
      if (cp) ctx.party.advance();
      const fresh = g.phase === "over";
      if (fresh) { g.streak = 0; g.newBest = false; }
      deal(!fresh);
      render(false, true);
      const f = host.querySelector(".pl-h-btns button"); f && f.focus({ preventScroll: true });
    }
  }
  function setMode(m) {
    if (!MODES.some(x => x[0] === m) || g.mode === m) return;
    g.mode = m; rec.mode = m; saveRec();
    g.streak = 0; g.newBest = false; g.hidden = null; g.known = null;
    deal(false);
    render(false, true);
  }

  /* ---------- drawing ---------- */
  function itemCard(it, role, revealed) {
    const val = h("output", { class: "pl-hc-v" }, h("span", { class: "pl-hc-num" }, role === "hidden" && !revealed ? "?" : fmtV(it)), h("small", null, unitOf(it)));
    const photo = it.place && it.place.img ? ctx.gamePhoto(it.place, { size: "hero", alt: "" }) : null;
    return h("section", { class: `pl-hcard ${role}${role === "hidden" && revealed ? (g.ok ? " right" : " wrong") : ""}${photo ? " has-photo" : ""}`,
      "aria-label": `${role === "known" ? "Shown" : "To guess"}: ${it.name}${role === "known" || revealed ? ", " + fmtV(it) + " " + unitOf(it) : ""}` },
      photo,
      h("div", { class: "pl-hc-body" },
        h("small", { class: "pl-hc-k" }, CAT_LABEL[it.cat]),
        h("b", { class: "pl-hc-name" }, it.name),
        it.sub ? h("span", { class: "pl-hc-sub" }, it.sub) : null,
        val));
  }
  function render(justAnswered = false, entering = false) {
    host.textContent = "";
    strip = null;
    const partyOn = !!ctx.party && ctx.party.active();
    // mode chips
    const avail = cats();
    const modes = h("div", { class: "pl-hmodes", role: "group", "aria-label": "What to guess" },
      MODES.filter(m => m[0] === "mix" ? avail.length > 1 : avail.includes(m[0])).map(([id, name]) => h("button", { class: "pl-hmode", type: "button", "data-mode": id, "aria-pressed": String(g.mode === id),
        onclick: safe(() => setMode(id), "mode") }, name)));
    host.append(modes);
    if (partyOn) {
      strip = ctx.party.strip();
      host.append(strip, h("p", { class: "pl-turn", role: "status" }, h("b", null, `${ctx.party.current().n}'s turn`), g.phase === "ask" ? " Higher or lower?" : ""));
    } else {
      const best = rec.bests[g.mode] || 0;
      host.append(h("div", { class: "pl-pl-stats pl-h-stats" },
        h("div", { class: "pl-stat" + (g.streak >= 3 ? " hot" : "") }, h("b", null, g.streak), h("span", null, g.streak === 1 ? "in a row" : "in a row")),
        h("div", { class: "pl-stat" }, h("b", null, best), h("span", null, "best streak")),
        h("div", { class: "pl-stat" }, h("b", null, rec.games), h("span", null, "games over"))));
    }
    if (g.phase === "none" || !g.known || !g.hidden) {
      host.append(h("div", { class: "pl-q pl-empty" }, h("p", { class: "pl-qt" }, "This game needs the road's numbers."), h("p", { class: "pl-why" }, "Elevations, miles and mission dates show up here once the road data loads.")));
      host.append(live);
      return;
    }
    const revealed = g.phase !== "ask";
    const table = h("div", { class: "pl-htable" + (entering ? " entering" : "") }, itemCard(g.known, "known", true), h("div", { class: "pl-h-vs", "aria-hidden": "true" }, "VS"), itemCard(g.hidden, "hidden", revealed));
    host.append(table);
    const [question, up, down] = askOf(g.known, g.hidden);
    host.append(h("h3", { class: "pl-qt pl-h-q", tabindex: "-1" }, question));
    const btns = h("div", { class: "pl-h-btns", role: "group", "aria-label": "Your guess" },
      h("button", { class: "pl-hbtn up" + (revealed && g.correct === "up" ? " right" : "") + (revealed && g.ok === false && g.correct !== "up" ? " wrong" : ""), type: "button", "data-d": "up", disabled: revealed,
        onclick: safe(() => answer("up"), "guess up") }, icon("up"), up),
      h("button", { class: "pl-hbtn down" + (revealed && g.correct === "down" ? " right" : "") + (revealed && g.ok === false && g.correct !== "down" ? " wrong" : ""), type: "button", "data-d": "down", disabled: revealed,
        onclick: safe(() => answer("down"), "guess down") }, icon("down"), down));
    host.append(btns);
    if (revealed) {
      const cp = partyOn ? ctx.party.current() : null;
      const fb = h("div", { class: "pl-fb " + (g.ok ? "ok" : "no"), role: "status" },
        h("div", { class: "pl-verdict", tabindex: "-1" }, icon(g.ok ? "check" : "cross", "pl-ic pl-vic"),
          h("b", null, g.ok ? (!partyOn && g.streak >= 3 ? `That's right. ${g.streak} in a row.` : "That's right.") : "Not quite.")),
        h("p", { class: "pl-ans" }, fullSentence(g.known, g.hidden)),
        g.ok && g.newBest && !partyOn ? h("p", { class: "pl-why" }, "A new best streak.") : null,
        !g.ok && !partyOn ? h("p", { class: "pl-why" }, `Your streak ended at ${g.streak}. Best in this mode: ${rec.bests[g.mode] || 0}.`) : null);
      const link = g.hidden.place ? h("button", { class: "link pl-hmore", type: "button", onclick: safe(() => ctx.openPlace(g.hidden.place), "about") }, `About ${g.hidden.name}`) : null;
      if (link) fb.append(h("p", { class: "pl-src" }, link));
      fb.append(h("button", { class: "primary pl-next", type: "button", "data-k": "next", onclick: safe(next, "next") },
        g.phase === "over" ? "Play again" : partyOn ? "Next, pass the phone" : "Keep going", icon("next")));
      host.append(fb);
      // the number counts up into the hidden card
      const numEl = host.querySelector(".pl-hcard.hidden .pl-hc-num");
      if (numEl && justAnswered) {
        const to = g.hidden.v, from = Math.max(0, to - (g.hidden.cat === "mission" ? 8 : g.hidden.cat === "elev" ? Math.max(40, Math.round(to * 0.3)) : Math.round(to * 0.25)));
        ctx.countUp(numEl, from, to, 650, v => fmtV({ ...g.hidden, v: Math.round(v) }));
      }
      if (justAnswered) {
        const v = fb.querySelector(".pl-verdict"); v && v.focus({ preventScroll: true });
        try { fb.querySelector(".pl-next").scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }
      }
    }
    host.append(live);
  }

  deal(false);
  render();
  return {
    show() { if (g.phase === "ask" || g.phase === "none") { if (g.phase === "none") deal(false); render(); } },
    hide() {},
    answer, next, setMode,
    state: () => ({ mode: g.mode, phase: g.phase, cat: g.cat, known: g.known && { ...g.known, place: undefined }, hidden: g.hidden && { ...g.hidden, place: undefined }, streak: g.streak, best: rec.best, bests: { ...rec.bests }, correct: g.correct, ok: g.ok, cats: cats() }),
  };
}
