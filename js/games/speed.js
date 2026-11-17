// Speed trivia: 10 questions from the same pool as classic trivia, a short clock on each one, a score at the end.
// Store key "triviaSpeed": {best, rounds}. The classic score ("trivia") is not touched.

const ROUND = 10;     // questions in a round
const SECS = 15;      // seconds for each question
const RIGHT_HOLD = 1100, WRONG_HOLD = 1800;   // how long the answer stays up before the next question (ms)

export function create(ctx) {
  const { h, icon, safe, shuffle, num } = ctx;
  const LET = ctx.trivia.LETTERS, ct = ctx.trivia.choiceText;
  const host = ctx.pane;
  let sp = { phase: "ready", qs: [], i: 0, right: 0, fastest: null, picked: null, t0: 0, deadline: 0, left: 0, timer: 0, advance: 0, paused: false, newBest: false };
  let clockEl = null, numEl = null;
  const live = h("p", { class: "pl-sr", role: "status" });

  const rec = () => { const r = ctx.store("triviaSpeed", null) || {}; return { best: Math.max(0, num(r.best)), rounds: Math.max(0, num(r.rounds)) }; };
  const stop = () => { clearInterval(sp.timer); clearTimeout(sp.advance); sp.timer = 0; sp.advance = 0; };
  const say = t => { live.textContent = ""; setTimeout(() => { live.textContent = t; }, 30); };

  function start() {
    const all = ctx.trivia.questions();
    stop();
    if (!all.length) { sp = { ...sp, phase: "none" }; return render(); }
    sp = { phase: "play", qs: shuffle(all.slice()).slice(0, Math.min(ROUND, all.length)), i: 0, right: 0, fastest: null, picked: null, t0: 0, deadline: 0, left: 0, timer: 0, advance: 0, paused: false, newBest: false };
    ctx.unlock();
    ask();
  }
  function ask() {
    stop();
    sp.picked = null;
    sp.t0 = Date.now();
    sp.deadline = sp.t0 + SECS * 1000;
    sp.timer = setInterval(tick, 200);
    render();
    say(`Question ${sp.i + 1} of ${sp.qs.length}.`);
  }
  function tick() {
    if (sp.phase !== "play" || sp.picked != null) return;
    const left = Math.max(0, (sp.deadline - Date.now()) / 1000);
    sp.left = left;
    if (numEl) numEl.textContent = String(Math.ceil(left));
    if (clockEl) clockEl.classList.toggle("low", left <= 5);
    if (left <= 0) timeUp();
  }
  function timeUp() {
    if (sp.phase !== "play" || sp.picked != null) return;
    stop();
    sp.picked = -1;
    ctx.buzz(60);
    render();
    say("Time is up.");
    sp.advance = setTimeout(safe(next, "speed next"), WRONG_HOLD);
  }
  function answer(i) {
    if (sp.phase !== "play" || sp.picked != null) return false;
    const q = sp.qs[sp.i];
    if (!q || !Number.isInteger(i) || i < 0 || i >= q.choices.length) return false;
    stop();
    sp.picked = i;
    const ok = i === q.answer;
    if (ok) {
      sp.right++;
      const ms = Date.now() - sp.t0;
      if (sp.fastest == null || ms < sp.fastest) sp.fastest = ms;
      ctx.chime("success");
      ctx.buzz(30);
    } else ctx.buzz(60);
    render();
    say(ok ? "Right." : `Not quite. The answer is ${LET[q.answer]}: ${ct(q.choices[q.answer])}.`);
    sp.advance = setTimeout(safe(next, "speed next"), ok ? RIGHT_HOLD : WRONG_HOLD);
    return ok;
  }
  function next() {
    stop();
    if (sp.i + 1 >= sp.qs.length) return finish();
    sp.i++;
    ask();
  }
  function finish() {
    stop();
    const r = rec(), n = sp.qs.length;
    sp.newBest = sp.right > r.best;
    ctx.save("triviaSpeed", { best: Math.max(r.best, sp.right), rounds: r.rounds + 1 });
    sp.phase = "done";
    render();
    say(`That is ${sp.right} of ${n}.`);
    if (n >= 5 && sp.right / n >= 0.8) ctx.cheer({ top: "SPEED TRIVIA", title: `${sp.right} OF ${n}`, sub: sp.newBest ? "A new best" : "Quick thinking" });
  }

  function render() {
    host.textContent = "";
    clockEl = numEl = null;
    host.append(live);
    if (sp.phase === "none") {
      host.append(h("div", { class: "pl-q pl-empty" }, h("p", { class: "pl-qt" }, "No trivia questions yet."),
        h("button", { class: "secondary", type: "button", onclick: safe(ctx.trivia.backToClassic, "back") }, "Back to classic")));
      return;
    }
    if (sp.phase === "ready") return renderReady();
    if (sp.phase === "done") return renderDone();
    const q = sp.qs[sp.i], answered = sp.picked != null;
    const top = h("div", { class: "pl-sp-top" },
      h("span", { class: "pl-sp-q" }, `Question ${sp.i + 1} of ${sp.qs.length}`),
      h("span", { class: "pl-sp-score" }, h("b", null, sp.right), " right"));
    const left = Math.max(0, (sp.deadline - Date.now()) / 1000);
    numEl = h("b", { class: "pl-sp-n", "aria-hidden": "true" }, String(answered ? Math.ceil(sp.left || 0) : Math.ceil(left)));
    clockEl = h("div", { class: "pl-sp-clock" + (answered ? " stopped" : "") + (left <= 5 && !answered ? " low" : ""), "aria-hidden": "true" },
      h("div", { class: "pl-sp-bar" }, h("i", { style: answered ? `--left:${Math.max(0, Math.min(1, (sp.left || 0) / SECS))}` : `--dur:${left.toFixed(2)}s;--start:${Math.max(0, Math.min(1, left / SECS)).toFixed(3)}` })),
      numEl);
    const opts = h("div", { class: "pl-opts", role: "group", "aria-label": "Answers" });
    q.choices.forEach((c, i) => {
      let state = "";
      if (answered) state = i === q.answer ? "right" : i === sp.picked ? "wrong" : "dim";
      const label = `${LET[i]}. ${ct(c)}` + (state === "right" ? ", correct answer" : state === "wrong" ? ", your answer, wrong" : "");
      opts.append(h("button", { class: `pl-opt ${state}`, type: "button", "data-i": i, disabled: answered, "aria-label": label },
        h("span", { class: "pl-let", "aria-hidden": "true" }, LET[i]),
        h("span", { class: "pl-opt-t", "aria-hidden": "true" }, ct(c)),
        state === "right" ? icon("check", "pl-ic pl-mark") : state === "wrong" ? icon("cross", "pl-ic pl-mark") : null));
    });
    host.append(h("div", { class: "pl-q pl-sp-card" }, top, clockEl, h("h3", { class: "pl-qt" }, q.q), opts,
      answered && sp.picked === -1 ? h("p", { class: "pl-note", role: "status" }, "Time is up. The answer is highlighted.") : null));
  }
  function renderReady() {
    const r = rec();
    host.append(h("div", { class: "pl-sp-ready" },
      h("div", { class: "pl-sp-sign" },
        h("span", { class: "pl-sp-kicker" }, "Speed round"),
        h("b", null, `${Math.min(ROUND, ctx.trivia.questions().length || ROUND)} questions`),
        h("span", null, `${SECS} seconds each`)),
      h("p", { class: "pl-why" }, "Same questions as classic trivia, but the clock is running. A right answer scores one point."),
      r.rounds ? h("p", { class: "pl-sp-best" }, `Best round ${r.best} of ${ROUND} · ${r.rounds} ${r.rounds === 1 ? "round" : "rounds"} played`) : null,
      h("button", { class: "primary pl-sp-go", type: "button", "data-k": "start", onclick: safe(start, "speed start") }, "Start the round")));
  }
  function renderDone() {
    const n = sp.qs.length, r = rec();
    host.append(h("div", { class: "pl-sp-done" },
      h("div", { class: "pl-sp-sign" },
        h("span", { class: "pl-sp-kicker" }, sp.newBest ? "A new best" : "Round complete"),
        h("b", { class: "pl-sp-big" }, `${sp.right} of ${n}`),
        h("span", null, sp.right === n ? "Every one right" : sp.right >= n * 0.7 ? "Quick thinking" : sp.right >= n * 0.4 ? "Not bad for a clock" : "The road has more to teach you")),
      h("p", { class: "pl-why" }, [sp.fastest != null ? `Fastest right answer: ${(sp.fastest / 1000).toFixed(1)} seconds.` : "No right answers this time.", ` Best round: ${r.best} of ${ROUND}.`].join("")),
      h("div", { class: "pl-row pl-sp-acts" },
        h("button", { class: "primary", type: "button", "data-k": "again", onclick: safe(start, "speed again") }, icon("shuffle"), "Play again"),
        h("button", { class: "secondary", type: "button", onclick: safe(ctx.trivia.backToClassic, "back") }, "Back to classic"))));
  }
  host.addEventListener("click", safe(e => {
    const b = e.target.closest("button[data-i]");
    if (b && !b.disabled) answer(+b.dataset.i);
  }, "speed tap"));

  function show() {
    // a round that was paused by leaving the screen picks up where it was
    if (sp.phase === "play" && sp.paused) {
      sp.paused = false;
      if (sp.picked == null) { sp.deadline = Date.now() + Math.max(1, sp.left) * 1000; sp.timer = setInterval(tick, 200); }
      else sp.advance = setTimeout(safe(next, "speed next"), 600);
    }
    render();
  }
  function hide() {
    if (sp.phase === "play" && !sp.paused) {
      if (sp.picked == null) sp.left = Math.max(0, (sp.deadline - Date.now()) / 1000);
      sp.paused = true;
    }
    stop();
  }
  render();
  return { show, hide, answer, start, state: () => ({ phase: sp.phase, i: sp.i, right: sp.right, n: sp.qs.length, picked: sp.picked, left: sp.left, current: sp.qs[sp.i] || null, questions: sp.qs }), SECS, ROUND };
}
