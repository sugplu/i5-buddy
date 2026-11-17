// Would You Rather, road trip edition: about 80 prompts (js/games/lines.js), pass-and-play voting, the split on screen.
// "Tap to vote": everybody taps A or B in turn (with a Car Party each vote has a name on it); "Say it out loud": the app
// only shows and reads the prompt. A player who picks with the crowd scores a point in a Car Party.
// Store key "wyr": {n, deck, pos, mode}: how many prompts were answered, the shuffled order, where we are in it.

const cap1 = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function create(ctx) {
  const { h, icon, safe, shuffle } = ctx;
  const host = ctx.pane;
  const P = ctx.WYR;
  const live = h("p", { class: "pl-sr", role: "status" });
  const rec0 = () => { const r = ctx.store("wyr", null); return r && typeof r === "object" ? r : {}; };
  let rec = { n: Math.max(0, ctx.num(rec0().n)), deck: Array.isArray(rec0().deck) ? rec0().deck.filter(i => Number.isInteger(i) && i >= 0 && i < P.length) : [], pos: Math.max(0, ctx.num(rec0().pos)), mode: rec0().mode === "say" ? "say" : "tap" };
  const saveRec = () => ctx.save("wyr", rec);
  if (rec.deck.length !== P.length || new Set(rec.deck).size !== P.length) { rec.deck = shuffle(P.map((_, i) => i)); rec.pos = 0; }
  if (rec.pos >= rec.deck.length) rec.pos = 0;
  let cur = null;   // {idx, votes: [{i, side}], shown: bool, split: {a, b}}

  const prompt = () => P[rec.deck[rec.pos]];
  function load() { cur = { idx: rec.deck[rec.pos], votes: [], shown: false, bonus: [] }; }
  const partyOn = () => !!ctx.party && ctx.party.active();
  const counts = () => ({ a: cur.votes.filter(v => v.side === "a").length, b: cur.votes.filter(v => v.side === "b").length });

  function vote(side) {
    if (rec.mode !== "tap" || cur.shown || (side !== "a" && side !== "b")) return false;
    const on = partyOn();
    if (on) {
      const p = ctx.party.current();
      if (cur.votes.some(v => v.i === p.i)) return false;
      cur.votes.push({ i: p.i, side });
      ctx.party.advance();
    } else cur.votes.push({ i: null, side });
    ctx.buzz(15);
    if (on && cur.votes.length >= ctx.party.players().length) return reveal();
    render();
    ctx.announce(on ? `Vote ${cur.votes.length} of ${ctx.party.players().length} is in.` : `${cur.votes.length} ${cur.votes.length === 1 ? "vote" : "votes"} so far.`);
    const b = host.querySelector(".pl-wyr-opt"); b && b.focus && b.focus({ preventScroll: true });
    return true;
  }
  function undo() {
    if (cur.shown || !cur.votes.length) return;
    const v = cur.votes.pop();
    if (v.i != null && partyOn()) ctx.party.setTurn(v.i);
    render();
    ctx.announce("Last vote taken back.");
  }
  function reveal() {
    if (cur.shown || !cur.votes.length) return false;
    cur.shown = true;
    const c = counts();
    if (partyOn() && c.a !== c.b) {
      const win = c.a > c.b ? "a" : "b";
      for (const v of cur.votes) if (v.side === win && v.i != null) { ctx.party.award(1, v.i); cur.bonus.push(v.i); }
    }
    rec.n++;
    saveRec();
    render(true);
    ctx.announce(summary());
    return true;
  }
  function summary() {
    const c = counts(), t = c.a + c.b;
    if (!t) return "";
    if (c.a === c.b) return `A tie, ${c.a} to ${c.b}.`;
    if (c.a === 0 || c.b === 0) return `Everyone picked ${c.a ? "A" : "B"}.`;
    return `${c.a > c.b ? "A" : "B"} wins, ${Math.max(c.a, c.b)} to ${Math.min(c.a, c.b)}.`;
  }
  function next() {
    if (rec.mode === "say" && !cur.shown) { rec.n++; }
    if (partyOn() && cur.shown) ctx.party.advance();
    rec.pos++;
    if (rec.pos >= rec.deck.length) { rec.deck = shuffle(P.map((_, i) => i)); rec.pos = 0; }
    saveRec();
    load();
    render(false, true);
    const b = host.querySelector(".pl-wyr-opt, .pl-next"); b && b.focus && b.focus({ preventScroll: true });
  }
  function skip() { rec.pos++; if (rec.pos >= rec.deck.length) { rec.deck = shuffle(P.map((_, i) => i)); rec.pos = 0; } saveRec(); load(); render(false, true); }
  function setMode(m) {
    if (m !== "tap" && m !== "say") return;
    rec.mode = m; saveRec();
    if (cur.shown) next(); else { cur.votes = []; render(); }
  }
  function readIt() {
    ctx.unlock();
    const idx = cur.idx;
    ctx.say(ctx.wyrSpeech(P[idx]), "play:wyr:" + idx, { check: () => cur && cur.idx === idx });
  }

  /* ---------- drawing ---------- */
  function optionEl(side, text) {
    const letter = side.toUpperCase();
    const inner = [h("span", { class: "pl-let", "aria-hidden": "true" }, letter), h("span", { class: "pl-wyr-t" }, cap1(text))];
    if (rec.mode === "say") return h("div", { class: `pl-wyr-opt say ${side}` }, inner);
    const mine = partyOn() ? cur.votes.some(v => v.i === ctx.party.current().i) : false;
    return h("button", { class: `pl-wyr-opt ${side}`, type: "button", "data-s": side, disabled: cur.shown || mine, "aria-label": `Vote ${letter}: ${text}`,
      onclick: safe(() => vote(side), "vote " + side) }, inner);
  }
  function render(justShown = false, entering = false) {
    host.textContent = "";
    const p = prompt(), on = partyOn();
    const modes = h("div", { class: "seg wide pl-pl-seg pl-wyr-modes", role: "group", "aria-label": "How to answer" },
      ...[["tap", "Tap to vote"], ["say", "Say it out loud"]].map(([id, t]) => h("button", { type: "button", "data-mode": id, "aria-pressed": String(rec.mode === id), onclick: safe(() => setMode(id), "mode") }, t)));
    host.append(modes);
    if (on) {
      host.append(ctx.party.strip(), h("p", { class: "pl-turn", role: "status" },
        rec.mode === "tap" ? (cur.shown ? h("b", null, "Here is the split") : [h("b", null, `${ctx.party.current().n}, pick one`), ` (${cur.votes.length} of ${ctx.party.players().length} in)`]) : h("b", null, `${ctx.party.current().n}, you go first`)));
    }
    host.append(h("p", { class: "pl-wyr-k" }, `Would you rather · ${rec.pos + 1} of ${P.length}`));
    host.append(h("div", { class: "pl-wyr-card" + (entering ? " entering" : "") },
      optionEl("a", p[0]), h("div", { class: "pl-wyr-or", "aria-hidden": "true" }, "or"), optionEl("b", p[1])));
    // the split
    if (cur.shown) {
      const c = counts(), t = c.a + c.b || 1;
      const row = (side, text) => {
        const pct = Math.round(c[side] / t * 100);
        const names = on ? cur.votes.filter(v => v.side === side).map(v => ctx.party.players()[v.i]).filter(Boolean) : [];
        return h("div", { class: `pl-split-row ${side}${c[side] > c[side === "a" ? "b" : "a"] ? " win" : ""}` },
          h("span", { class: "pl-split-l" }, side.toUpperCase()),
          h("div", { class: "pl-split-bar", role: "img", "aria-label": `${side.toUpperCase()}: ${c[side]} of ${c.a + c.b}, ${pct} percent` }, h("i", { style: `--w:${pct}%` })),
          h("span", { class: "pl-split-n" }, h("b", null, c[side]), h("small", null, `${pct}%`)),
          names.length ? h("ul", { class: "pl-split-who" }, names.map(pl => h("li", { class: "pl-pchip", style: ctx.colorStyle(pl.c) }, h("b", null, pl.n)))) : null);
      };
      host.append(h("div", { class: "pl-split" + (justShown ? " fresh" : ""), role: "status" }, row("a", p[0]), row("b", p[1]), h("p", { class: "pl-split-s" }, summary(),
        on && cur.bonus.length ? ` ${cur.bonus.length === 1 ? "One point" : cur.bonus.length + " points"} for picking with the crowd.` : "")));
    } else if (rec.mode === "tap" && !on && cur.votes.length) {
      host.append(h("p", { class: "pl-wyr-count", role: "status" }, h("b", null, cur.votes.length), cur.votes.length === 1 ? " vote in. The split stays hidden until you show it." : " votes in. The split stays hidden until you show it."));
    }
    const acts = h("div", { class: "pl-row pl-wyr-acts" });
    if (ctx.canSpeak()) acts.append(h("button", { class: "secondary pl-tool", type: "button", "data-k": "read", onclick: safe(readIt, "read") }, icon("speaker"), "Read it out loud"));
    if (rec.mode === "tap" && !cur.shown) {
      if (!on) acts.append(h("button", { class: "primary pl-tool", type: "button", "data-k": "show", disabled: !cur.votes.length, onclick: safe(reveal, "show split") }, "Show the split"));
      if (cur.votes.length) acts.append(h("button", { class: "link pl-undo", type: "button", "data-k": "undo", onclick: safe(undo, "undo") }, icon("undo", "pl-ic"), "Undo last vote"));
    }
    host.append(acts);
    if (cur.shown || rec.mode === "say") {
      host.append(h("button", { class: "primary pl-next", type: "button", "data-k": "next", onclick: safe(next, "next") }, "Next one", icon("next")));
    } else {
      host.append(h("button", { class: "link pl-skip2", type: "button", "data-k": "skip", onclick: safe(skip, "skip") }, "Skip this one"));
    }
    host.append(live);
  }

  load();
  render();
  return {
    show() { render(); },
    hide() {},
    vote, reveal, next, undo, setMode, readIt,
    state: () => ({ mode: rec.mode, idx: cur.idx, pos: rec.pos, n: rec.n, votes: cur.votes.map(v => ({ ...v })), shown: cur.shown, counts: counts(), total: P.length, deck: rec.deck.slice() }),
  };
}
