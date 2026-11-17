// Alphabet Road Game: find a word on a sign that starts with A, then B, all the way to Z. Big letter, tap when found, a timer.
// Solo, or two teams taking turns (a letter found scores a point for the team on turn). Tips for Q, X and Z ("Exit" counts for X).
// Store key "alpha": {best (seconds, solo), games, cur: a game in progress}. The timer stops while the game is not on screen.

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const fmtTime = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function create(ctx) {
  const { h, icon, safe, colorStyle } = ctx;
  const host = ctx.pane;
  const live = h("p", { class: "pl-sr", role: "status" });
  const rec0 = () => { const r = ctx.store("alpha", null); return r && typeof r === "object" ? r : {}; };
  let rec = { best: Math.max(0, ctx.num(rec0().best)), games: Math.max(0, ctx.num(rec0().games)), cur: validCur(rec0().cur) ? rec0().cur : null };
  const saveRec = () => ctx.save("alpha", rec);
  let a = { phase: "ready", mode: "solo", queue: [], found: [], elapsed: 0, since: 0, running: false, hold: false, names: ["Team 1", "Team 2"], scores: [0, 0], turn: 0, newBest: false, skips: 0 };
  let timerEl = null, tick = 0;

  function validCur(c) {
    return !!c && typeof c === "object" && Array.isArray(c.queue) && Array.isArray(c.found) && c.queue.length > 0 && c.queue.every(l => LETTERS.includes(l)) && c.found.every(l => LETTERS.includes(l)) && (c.mode === "solo" || c.mode === "teams");
  }
  const now = () => Date.now();
  const total = () => a.elapsed + (a.running ? now() - a.since : 0);
  function snapshot() {
    if (a.phase !== "play") { rec.cur = null; return saveRec(); }
    rec.cur = { mode: a.mode, queue: a.queue.slice(), found: a.found.slice(), elapsed: total(), names: a.names.slice(), scores: a.scores.slice(), turn: a.turn, skips: a.skips };
    saveRec();
  }
  function run(on) {
    if (on && !a.running) { a.since = now(); a.running = true; }
    else if (!on && a.running) { a.elapsed += now() - a.since; a.running = false; }
    clearInterval(tick); tick = 0;
    if (a.running) tick = setInterval(() => { if (timerEl) timerEl.textContent = fmtTime(total()); }, 500);
  }

  /* ---------- play ---------- */
  function start(resume) {
    ctx.unlock();
    if (resume && rec.cur) {
      const c = rec.cur;
      a = { ...a, phase: "play", mode: c.mode, queue: c.queue.slice(), found: c.found.slice(), elapsed: ctx.num(c.elapsed), running: false, hold: false, names: (c.names || a.names).slice(0, 2), scores: (c.scores || [0, 0]).slice(0, 2), turn: ctx.num(c.turn) % 2, newBest: false, skips: ctx.num(c.skips) };
    } else {
      a = { ...a, phase: "play", queue: LETTERS.slice(), found: [], elapsed: 0, running: false, hold: false, scores: [0, 0], turn: 0, newBest: false, skips: 0 };
    }
    run(true);
    snapshot();
    render(true);
    say();
  }
  const letter = () => a.queue[0];
  function say() { const l = letter(); if (l) ctx.announce(ctx.alphaSpeech(l) + (ctx.ALPHA_TIPS[l] ? " " + ctx.ALPHA_TIPS[l] : "")); }
  function found() {
    if (a.phase !== "play" || !a.running || !a.queue.length) return false;
    const l = a.queue.shift();
    a.found.push(l);
    if (a.mode === "teams") { a.scores[a.turn]++; a.turn = 1 - a.turn; }
    ctx.buzz(25);
    if (!a.queue.length) { finish(); return true; }
    snapshot();
    render(true);
    say();
    return true;
  }
  function pass() {
    if (a.phase !== "play" || !a.running || a.queue.length < 1) return false;
    if (a.mode === "teams") a.turn = 1 - a.turn;                     // the other team tries the same letter
    else if (a.queue.length > 1) { a.queue.push(a.queue.shift()); a.skips++; }   // the letter goes to the back of the line
    snapshot();
    render(true);
    say();
    return true;
  }
  function finish() {
    run(false);
    const t = a.elapsed;
    a.phase = "done";
    if (a.mode === "solo") {
      const secs = Math.round(t / 1000);
      a.newBest = !rec.best || secs < rec.best;
      if (a.newBest) rec.best = secs;
    }
    rec.games++;
    rec.cur = null;
    saveRec();
    render();
    ctx.announce(a.mode === "solo" ? `You made it from A to Z in ${fmtTime(t)}.` : `That is A to Z. ${a.names[0]} ${a.scores[0]}, ${a.names[1]} ${a.scores[1]}.`);
    if (a.mode === "solo") ctx.cheer({ top: "ALPHABET GAME", title: "A TO Z", sub: `${fmtTime(t)}${a.newBest && rec.games > 1 ? ", a new best" : ""}`, speak: [ctx.LINES.alpha.done, "play:alpha:done"] });
    else {
      const [x, y] = a.scores;
      const title = x === y ? "A TIE" : `${(x > y ? a.names[0] : a.names[1]).toUpperCase().slice(0, 9)} WINS`;
      ctx.cheer({ top: "ALPHABET GAME", title, sub: `${x} to ${y}`, speak: [ctx.LINES.alpha.done, "play:alpha:done"] });
    }
  }
  function toggleRun() {
    if (a.phase !== "play") return;
    a.hold = a.running;   // a pause the person asked for stays until they resume
    run(!a.running);
    snapshot();
    render();
    ctx.announce(a.running ? "Timer is running." : "Paused.");
  }
  function speakLetter() {
    const l = letter();
    if (!l) return;
    ctx.unlock();
    ctx.say(ctx.alphaSpeech(l), "play:alpha:" + l);
    if (ctx.ALPHA_TIPS[l]) ctx.say(ctx.ALPHA_TIPS[l], "play:alpha:tip:" + l);
  }
  function setMode(m) { if (m === "solo" || m === "teams") { a.mode = m; render(); } }

  /* ---------- drawing ---------- */
  function teamStyle(i) { return colorStyle(i === 0 ? "gold" : "blue"); }
  function render(letterChanged = false) {
    host.textContent = "";
    timerEl = null;
    host.append(live);
    if (a.phase === "ready") return renderReady();
    if (a.phase === "done") return renderDone();
    const l = letter();
    if (!l) return;
    const t = ctx.ALPHA_TIPS[l];
    const teams = a.mode === "teams";
    timerEl = h("b", { class: "pl-al-time", "aria-hidden": "true" }, fmtTime(total()));
    host.append(h("div", { class: "pl-al-top" },
      h("span", { class: "pl-sp-q" }, `Letter ${a.found.length + 1} of 26`),
      h("span", { class: "pl-al-clock" }, icon("clock", "pl-ic"), timerEl)));
    if (teams) {
      host.append(h("ul", { class: "pl-al-teams", "aria-label": "Team scores" }, [0, 1].map(i => h("li", { class: "pl-pchip" + (a.turn === i ? " turn" : ""), style: teamStyle(i),
        "aria-label": `${a.names[i]}, ${a.scores[i]} ${a.scores[i] === 1 ? "point" : "points"}${a.turn === i ? ", their turn" : ""}` }, h("b", { "aria-hidden": "true" }, a.names[i]), h("span", { "aria-hidden": "true" }, a.scores[i])))));
      host.append(h("p", { class: "pl-turn", role: "status" }, h("b", null, `${a.names[a.turn]}'s turn`)));
    }
    host.append(h("div", { class: "pl-al-sign" + (letterChanged ? " fresh" : ""), role: "img", "aria-label": `The letter ${l}` }, h("b", { "aria-hidden": "true" }, l)));
    host.append(h("h3", { class: "pl-qt pl-al-q" }, `Find a word on a sign that starts with ${l}.`));
    if (t) host.append(h("p", { class: "pl-al-tip" }, icon("info", "pl-ic"), h("span", null, t)));
    const strip = h("ol", { class: "pl-al-strip", "aria-label": `${a.found.length} of 26 letters found` },
      LETTERS.map(x => h("li", { class: a.found.includes(x) ? "ok" : x === l ? "now" : "", "aria-hidden": "true" }, x)));
    host.append(strip);
    host.append(h("button", { class: "primary pl-al-found", type: "button", "data-k": "found", disabled: !a.running, onclick: safe(found, "found") }, icon("check"), "Found it"));
    host.append(h("div", { class: "pl-row pl-al-acts" },
      ctx.canSpeak() ? h("button", { class: "secondary pl-tool", type: "button", "data-k": "say", "aria-label": "Say the letter out loud", onclick: safe(speakLetter, "say") }, icon("speaker"), "Say it") : null,
      h("button", { class: "secondary pl-tool", type: "button", "data-k": "pass", disabled: !a.running, onclick: safe(pass, "pass") }, teams ? "Pass to the other team" : "Skip for now"),
      h("button", { class: "secondary pl-tool", type: "button", "data-k": "pause", "aria-pressed": String(!a.running), onclick: safe(toggleRun, "pause") }, a.running ? "Pause" : "Resume")));
    if (!a.running) host.append(h("p", { class: "pl-al-paused", role: "status" }, "Paused. The timer waits for you."));
    host.append(h("button", { class: "link pl-skip2", type: "button", "data-k": "quit", onclick: safe(() => { run(false); a.phase = "ready"; rec.cur = null; saveRec(); render(); }, "quit") }, "End this game"));
  }
  function renderReady() {
    const c = rec.cur;
    host.append(h("div", { class: "pl-sp-ready" },
      h("div", { class: "pl-sp-sign" }, h("span", { class: "pl-sp-kicker" }, "Signs, billboards, trucks"), h("b", null, "A to Z"), h("span", null, "Find a word that starts with each letter")),
      h("div", { class: "seg wide pl-pl-seg", role: "group", "aria-label": "Who is playing" },
        ...[["solo", "Everyone together"], ["teams", "Two teams"]].map(([id, t]) => h("button", { type: "button", "data-mode": id, "aria-pressed": String(a.mode === id), onclick: safe(() => setMode(id), "mode") }, t)))));
    if (a.mode === "teams") {
      host.append(h("div", { class: "pl-al-names" }, [0, 1].map(i => h("label", { class: "pl-al-name", style: teamStyle(i) },
        h("span", { class: "pl-al-swatch", "aria-hidden": "true" }),
        h("span", { class: "pl-sr" }, `Name for team ${i + 1}`),
        h("input", { type: "text", value: a.names[i], maxlength: "12", autocomplete: "off", autocapitalize: "words", "aria-label": `Name for team ${i + 1}`,
          oninput: safe(e => { a.names[i] = e.target.value.slice(0, 12) || `Team ${i + 1}`; }, "name") })))));
      host.append(h("p", { class: "pl-why" }, "Teams take turns. The team on turn tries to find the letter; a find scores a point and the other team gets the next letter."));
    } else {
      host.append(h("p", { class: "pl-why" }, "Everyone looks together. Tap Found it when someone spots a word on a sign. Letters you skip come back at the end."));
    }
    host.append(h("p", { class: "pl-al-tip" }, icon("info", "pl-ic"), h("span", null, "Hard ones: Q, X and Z. The word Exit counts for X.")));
    if (c) host.append(h("div", { class: "pl-confirm pl-al-resume" }, h("p", null, `A game is waiting: ${c.found.length} of 26 found, ${fmtTime(c.elapsed)} on the clock.`),
      h("div", { class: "pl-row" }, h("button", { class: "primary", type: "button", "data-k": "resume", onclick: safe(() => start(true), "resume") }, "Pick it up"))));
    if (rec.best) host.append(h("p", { class: "pl-sp-best" }, `Best time ${fmtTime(rec.best * 1000)} · ${rec.games} ${rec.games === 1 ? "game" : "games"} finished`));
    host.append(h("button", { class: "primary pl-sp-go", type: "button", "data-k": "start", onclick: safe(() => start(false), "start") }, c ? "Start over" : "Start the clock"));
  }
  function renderDone() {
    const teams = a.mode === "teams";
    const [x, y] = a.scores;
    host.append(h("div", { class: "pl-sp-done" },
      h("div", { class: "pl-sp-sign" },
        h("span", { class: "pl-sp-kicker" }, teams ? "Final score" : a.newBest ? "A new best time" : "You made it"),
        h("b", { class: "pl-sp-big" }, teams ? (x === y ? "A tie" : `${x > y ? a.names[0] : a.names[1]} wins`) : fmtTime(a.elapsed)),
        h("span", null, teams ? `${a.names[0]} ${x}, ${a.names[1]} ${y} · ${fmtTime(a.elapsed)}` : `A to Z${a.skips ? `, with ${a.skips} ${a.skips === 1 ? "skip" : "skips"}` : ""}`)),
      !teams && rec.best ? h("p", { class: "pl-why" }, `Best time: ${fmtTime(rec.best * 1000)}.`) : null,
      h("div", { class: "pl-row pl-sp-acts" },
        h("button", { class: "primary", type: "button", "data-k": "again", onclick: safe(() => { a.phase = "ready"; render(); }, "again") }, icon("shuffle"), "Play again"),
        h("button", { class: "secondary", type: "button", onclick: safe(() => ctx.api.play.open("home"), "home") }, "All games"))));
  }

  render();
  return {
    show() { if (a.phase === "play") { if (!a.hold) run(true); snapshot(); } render(); },
    hide() { if (a.phase === "play") { run(false); snapshot(); } },
    start, found, pass, toggleRun, setMode,
    state: () => ({ phase: a.phase, mode: a.mode, letter: letter() || null, found: a.found.slice(), left: a.queue.length, running: a.running, elapsed: total(), scores: a.scores.slice(), turn: a.turn, best: rec.best, games: rec.games, hasCur: !!rec.cur }),
  };
}
