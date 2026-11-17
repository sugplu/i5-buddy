// Where Is This?: a photo quiz from the landmarks that have a photo. One photo, four names (look-alikes from the same
// stretch of road when there are any), then the place's first sentence and a button to open its page.
// A round is 10 photos. Store key "where": {best, rounds, right}. The photo's credit stays on screen, as everywhere else.

const ROUND = 10;

export function create(ctx) {
  const { h, icon, safe, shuffle, shortName, firstSentence, sameish } = ctx;
  const host = ctx.pane;
  const LET = ["A", "B", "C", "D"];
  const rec0 = () => { const r = ctx.store("where", null); return r && typeof r === "object" ? r : {}; };
  let rec = { best: Math.max(0, ctx.num(rec0().best)), rounds: Math.max(0, ctx.num(rec0().rounds)), right: Math.max(0, ctx.num(rec0().right)) };
  const saveRec = () => ctx.save("where", rec);
  let w = { phase: "ready", qs: [], i: 0, score: 0, picked: null, hint: false, mine: [], used: new Set(), swaps: 0, newBest: false };
  const live = h("p", { class: "pl-sr", role: "status" });
  let figFor = null;   // {id, el}: the photo on screen
  const D = () => ctx.D();

  const eligible = () => (Array.isArray(D().PLACES) ? D().PLACES : []).filter(p => p && p.img && p.img.f && typeof p.text === "string" && p.text.trim() && p.name && isFinite(p.m) && shortName(p).length <= 40);
  const regionId = m => { try { return D().regionAt?.(m)?.id || ""; } catch { return ""; } };

  /* ---------- building a question ---------- */
  function choicesFor(p, pool) {
    const ans = shortName(p), rid = regionId(p.m);
    const others = pool.filter(o => o.id !== p.id && Math.abs(o.m - p.m) >= 1 && !sameish(shortName(o), ans));
    const near = others.slice().sort((a, b) => Math.abs(a.m - p.m) - Math.abs(b.m - p.m));
    const sameRegion = near.filter(o => regionId(o.m) === rid);
    const picks = [];
    const take = list => {
      for (const o of shuffle(list.slice(0, 16))) {
        if (picks.length >= 3) break;
        const n = shortName(o);
        if (picks.some(x => sameish(shortName(x), n))) continue;
        picks.push(o);
      }
    };
    take(sameRegion);
    if (picks.length < 3) take(near.filter(o => !picks.includes(o)));
    if (picks.length < 3) return null;
    const names = shuffle([ans, ...picks.map(shortName)]);
    return { p, names, answer: names.indexOf(ans) };
  }
  function makeRound() {
    const pool = eligible();
    if (pool.length < 4) return [];
    let fresh = pool.filter(p => !w.used.has(p.id));
    if (fresh.length < ROUND) { w.used.clear(); fresh = pool.slice(); }
    const qs = [];
    const spread = [];
    for (const p of shuffle(fresh)) {
      if (qs.length >= ROUND) break;
      if (spread.some(m => Math.abs(m - p.m) < 4)) continue;   // not two photos from the same few miles
      const q = choicesFor(p, pool);
      if (q) { qs.push(q); spread.push(p.m); }
    }
    for (const p of shuffle(fresh)) {   // too few far-apart ones: fill up
      if (qs.length >= ROUND) break;
      if (qs.some(q => q.p.id === p.id)) continue;
      const q = choicesFor(p, pool);
      if (q) qs.push(q);
    }
    return qs;
  }
  function replace(i) {   // a photo that would not load: another place in its spot
    const pool = eligible(), have = new Set(w.qs.map(q => q.p.id));
    for (const p of shuffle(pool.filter(x => !have.has(x.id) && !w.used.has(x.id)))) {
      const q = choicesFor(p, pool);
      if (q) { w.qs[i] = q; return true; }
    }
    return false;
  }

  /* ---------- play ---------- */
  function start() {
    w.qs = makeRound();
    for (const q of w.qs) w.used.add(q.p.id);
    if (!w.qs.length) { w.phase = "none"; return render(); }
    w.phase = "ask"; w.i = 0; w.score = 0; w.picked = null; w.hint = false; w.swaps = 0; w.newBest = false; w.mine = [];
    if (ctx.party && ctx.party.active()) { /* scores carry on across rounds: reset them with the scoreboard */ }
    ctx.unlock();
    render();
    preload(1);
  }
  function preload(k) { const q = w.qs[w.i + k]; if (q) { try { const im = new Image(); im.src = q.p.img.f; } catch { /* no preload */ } } }
  function pickAnswer(i) {
    if (w.phase !== "ask") return null;
    const q = w.qs[w.i];
    if (!q || !Number.isInteger(i) || i < 0 || i >= q.names.length) return null;
    w.picked = i;
    w.phase = "reveal";
    const ok = i === q.answer;
    w.mine[w.i] = ok;
    const cp = ctx.party && ctx.party.active() ? ctx.party.current() : null;
    if (ok) { w.score++; if (cp) ctx.party.award(1); ctx.chime("success"); ctx.buzz(30); } else ctx.buzz([50, 40, 50]);
    render(true);
    ctx.announce(`${ok ? ctx.LINES.where.good : ctx.LINES.where.miss} ${firstSentence(q.p.text)}`);
    ctx.autoSay(ok ? ctx.LINES.where.good : ctx.LINES.where.miss, "play:where:" + (ok ? "good" : "miss"));
    return ok;
  }
  function next() {
    if (w.phase !== "reveal") return;
    if (ctx.party && ctx.party.active()) ctx.party.advance();
    if (w.i + 1 >= w.qs.length) return finish();
    w.i++; w.picked = null; w.hint = false; w.phase = "ask"; w.swaps = 0;
    render(false, true);
    preload(1);
    const t = host.querySelector(".pl-w-q"); t && t.focus({ preventScroll: true });
  }
  function finish() {
    const partyOn = !!ctx.party && ctx.party.active();
    rec.rounds++; rec.right += w.score;
    if (!partyOn) { w.newBest = w.score > rec.best; rec.best = Math.max(rec.best, w.score); }
    saveRec();
    w.phase = "done";
    render();
    ctx.announce(partyOn ? "That is the round." : `That is ${w.score} of ${w.qs.length}.`);
    if (partyOn) {
      const lead = ctx.party.leaders();
      if (lead.length === 1) ctx.cheer({ top: "WHERE IS THIS?", title: `${lead[0].n.toUpperCase().slice(0, 9)} WINS`, sub: `${lead[0].s} ${lead[0].s === 1 ? "point" : "points"}`, speak: [ctx.LINES.where.round, "play:where:round"] });
    } else if (w.qs.length >= 5 && w.score / w.qs.length >= 0.8) {
      ctx.cheer({ top: "WHERE IS THIS?", title: `${w.score} OF ${w.qs.length}`, sub: w.newBest ? "A new best round" : "Sharp eyes", speak: [ctx.LINES.where.round, "play:where:round"] });
    }
  }
  function hear() {
    const q = w.qs[w.i];
    if (!q) return;
    ctx.unlock();
    ctx.say(firstSentence(q.p.text), "play:where:s:" + q.p.id, { check: () => w.qs[w.i] === q });
  }

  /* ---------- drawing ---------- */
  function render(justAnswered = false, entering = false) {
    host.textContent = "";
    host.append(live);
    if (w.phase === "none") {
      host.append(h("div", { class: "pl-q pl-empty" }, h("p", { class: "pl-qt" }, "No photos yet."), h("p", { class: "pl-why" }, "This game needs the landmark photos. They come with the app.")));
      return;
    }
    if (w.phase === "ready") return renderReady();
    if (w.phase === "done") return renderDone();
    const q = w.qs[w.i], answered = w.phase === "reveal";
    const partyOn = !!ctx.party && ctx.party.active();
    if (partyOn) host.append(ctx.party.strip(), h("p", { class: "pl-turn", role: "status" }, h("b", null, `${ctx.party.current().n}'s turn`)));
    host.append(h("div", { class: "pl-w-top" },
      h("span", { class: "pl-sp-q" }, `Photo ${w.i + 1} of ${w.qs.length}`),
      h("span", { class: "pl-sp-score" }, h("b", null, w.score), " right")));
    const alt = answered ? `${shortName(q.p)}. ${q.p.img.alt || ""}`.trim() : "A photo from along I-5. Which place is it?";
    let fig;
    if (figFor && figFor.id === q.p.id) { fig = figFor.el; const im = fig.querySelector("img"); if (im) im.alt = alt; }   // the same photo: keep it (no flicker when the answer shows)
    else {
      fig = ctx.gamePhoto(q.p, { size: "full", alt, onError: () => {
        if (w.qs[w.i] !== q || w.phase !== "ask" || w.swaps >= 6) return;
        w.swaps++;
        if (replace(w.i)) render(false, true);
      } });
      figFor = { id: q.p.id, el: fig };
    }
    host.append(h("div", { class: "pl-w-photo" + (entering ? " entering" : "") }, fig));
    host.append(h("h3", { class: "pl-qt pl-w-q", tabindex: "-1" }, "Where is this?"));
    const opts = h("div", { class: "pl-opts", role: "group", "aria-label": "Answers" });
    q.names.forEach((n, i) => {
      let state = "";
      if (answered) state = i === q.answer ? "right" : i === w.picked ? "wrong" : "dim";
      const label = `${LET[i]}. ${n}` + (state === "right" ? ", correct answer" : state === "wrong" ? ", your answer, wrong" : "");
      opts.append(h("button", { class: `pl-opt ${state}`, type: "button", "data-i": i, disabled: answered, "aria-label": label, onclick: safe(() => pickAnswer(i), "pick " + i) },
        h("span", { class: "pl-let", "aria-hidden": "true" }, LET[i]),
        h("span", { class: "pl-opt-t", "aria-hidden": "true" }, n),
        state === "right" ? icon("check", "pl-ic pl-mark") : state === "wrong" ? icon("cross", "pl-ic pl-mark") : null));
    });
    host.append(opts);
    if (!answered) {
      const rn = ctx.regionName(q.p.m);
      host.append(h("div", { class: "pl-tools" },
        !w.hint && rn ? h("button", { class: "secondary pl-tool", type: "button", "data-k": "hint", onclick: safe(() => { w.hint = true; render(); const b = host.querySelector(".pl-w-hint"); b && b.focus && b.focus({ preventScroll: true }); }, "hint") }, icon("info"), "Give me a hint") : null,
        w.hint ? h("p", { class: "pl-w-hint", tabindex: "-1" }, `Hint: look in ${rn}.`) : null));
      return;
    }
    const ok = w.picked === q.answer;
    const last = w.i + 1 >= w.qs.length;
    const fb = h("div", { class: "pl-fb " + (ok ? "ok" : "no"), role: "status" },
      h("div", { class: "pl-verdict", tabindex: "-1" }, icon(ok ? "check" : "cross", "pl-ic pl-vic"), h("b", null, ok ? "That's right." : "Not quite.")),
      ok ? null : h("p", { class: "pl-ans" }, `It is ${shortName(q.p)}.`),
      h("p", { class: "pl-why" }, firstSentence(q.p.text)));
    const acts = h("div", { class: "pl-row pl-w-acts" },
      ctx.canSpeak() ? h("button", { class: "secondary pl-tool", type: "button", "data-k": "hear", onclick: safe(hear, "hear") }, icon("speaker"), "Hear it") : null,
      h("button", { class: "secondary pl-tool", type: "button", "data-k": "more", onclick: safe(() => ctx.openPlace(q.p), "more") }, "Tell me more"));
    fb.append(acts, h("button", { class: "primary pl-next", type: "button", "data-k": "next", onclick: safe(next, "next") }, last ? "See the score" : "Next photo", icon("next")));
    host.append(fb);
    if (justAnswered) {
      const v = fb.querySelector(".pl-verdict"); v && v.focus({ preventScroll: true });
      try { fb.querySelector(".pl-next").scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }
    }
  }
  function renderReady() {
    const partyOn = !!ctx.party && ctx.party.active();
    if (partyOn) host.append(ctx.party.strip({ turns: false }));
    host.append(h("div", { class: "pl-sp-ready" },
      h("div", { class: "pl-sp-sign" }, h("span", { class: "pl-sp-kicker" }, "Photo quiz"), h("b", null, `${ROUND} photos`), h("span", null, "Pick the right name")),
      h("p", { class: "pl-why" }, partyOn ? "Everyone takes a turn. A right answer scores a point for the player whose turn it is." : "Each photo is a place on the road. Wrong answers come from the same stretch, so look closely."),
      !partyOn && rec.rounds ? h("p", { class: "pl-sp-best" }, `Best round ${rec.best} of ${ROUND} · ${rec.rounds} ${rec.rounds === 1 ? "round" : "rounds"} played`) : null,
      h("button", { class: "primary pl-sp-go", type: "button", "data-k": "start", onclick: safe(start, "start") }, "Start a round")));
  }
  function renderDone() {
    const n = w.qs.length, partyOn = !!ctx.party && ctx.party.active();
    const sign = partyOn
      ? h("div", { class: "pl-sp-sign" }, h("span", { class: "pl-sp-kicker" }, "Round complete"), h("b", { class: "pl-sp-big" }, (() => { const l = ctx.party.leaders(); return l.length === 1 ? `${l[0].n} leads` : l.length ? "A tie" : "No points yet"; })()),
        h("span", null, `${w.score} of ${n} right as a group`))
      : h("div", { class: "pl-sp-sign" }, h("span", { class: "pl-sp-kicker" }, w.newBest ? "A new best" : "Round complete"), h("b", { class: "pl-sp-big" }, `${w.score} of ${n}`),
        h("span", null, w.score === n ? "Every photo right" : w.score >= n * 0.7 ? "Sharp eyes" : w.score >= n * 0.4 ? "Not bad" : "The road has more to show you"));
    host.append(partyOn ? ctx.party.strip({ turns: false }) : null, h("div", { class: "pl-sp-done" }, sign,
      h("ul", { class: "pl-w-dots", "aria-label": "Your answers" }, w.qs.map((q, i) => h("li", { class: w.mine[i] ? "ok" : "no", "aria-label": `Photo ${i + 1}: ${w.mine[i] ? "right" : "missed"}, ${shortName(q.p)}` }, h("span", { "aria-hidden": "true" }, i + 1)))),
      partyOn ? null : h("p", { class: "pl-why" }, `Best round: ${rec.best} of ${ROUND}.`),
      h("div", { class: "pl-row pl-sp-acts" },
        h("button", { class: "primary", type: "button", "data-k": "again", onclick: safe(start, "again") }, icon("shuffle"), "Play again"),
        h("button", { class: "secondary", type: "button", onclick: safe(() => ctx.api.play.open("home"), "home") }, "All games"))));
  }

  render();
  return {
    show() { if (w.phase === "ask") render(); },
    hide() {},
    start, pickAnswer, next, hear,
    state: () => ({ phase: w.phase, i: w.i, n: w.qs.length, score: w.score, picked: w.picked, best: rec.best, rounds: rec.rounds,
      q: w.qs[w.i] ? { id: w.qs[w.i].p.id, names: w.qs[w.i].names.slice(), answer: w.qs[w.i].answer, name: shortName(w.qs[w.i].p) } : null, all: w.qs.map(q => ({ id: q.p.id, names: q.names.slice(), answer: q.answer })) }),
  };
}
