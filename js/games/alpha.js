// Alphabet Road Game: find a word on a sign that starts with A, then B, all the way to Z. Big letter, tap when found, a timer.
// Solo, or two teams taking turns (a letter found scores a point for the team on turn). Tips for Q, X and Z ("Exit" counts for X).
// Store key "alpha": {best (seconds, solo), games, cur: a game in progress}. The timer stops while the game is not on screen.

import { t } from "../i18n.js";
import * as i18n from "../i18n.js";
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const fmtTime = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function create(ctx) {
  const { h, icon, safe, colorStyle } = ctx;
  const host = ctx.pane;
  const live = h("p", { class: "pl-sr", role: "status" });
  const rec0 = () => { const r = ctx.store("alpha", null); return r && typeof r === "object" ? r : {}; };
  let rec = { best: Math.max(0, ctx.num(rec0().best)), games: Math.max(0, ctx.num(rec0().games)), cur: validCur(rec0().cur) ? rec0().cur : null };
  const saveRec = () => ctx.save("alpha", rec);
  let a = { phase: "ready", mode: "solo", queue: [], found: [], elapsed: 0, since: 0, running: false, hold: false, names: [t("games.alpha.team_1"), t("games.alpha.team_2")], scores: [0, 0], turn: 0, newBest: false, skips: 0 };
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
    ctx.announce(a.mode === "solo" ? i18n.t("games.alpha.you_made_it_from_a_to_z_in_t", { t: fmtTime(t) }) : i18n.t("games.alpha.that_is_a_to_z_x1_x2_x3_x4", { x1: a.names[0], x2: a.scores[0], x3: a.names[1], x4: a.scores[1] }));
    if (a.mode === "solo") ctx.cheer({ top: i18n.t("games.alpha.alphabet_game"), title: i18n.t("games.alpha.a_to_z"), sub: `${fmtTime(t)}${a.newBest && rec.games > 1 ? i18n.t("games.alpha.a_new_best") : ""}`, speak: [ctx.LINES.alpha.done, "play:alpha:done"] });
    else {
      const [x, y] = a.scores;
      const title = x === y ? i18n.t("games.alpha.a_tie") : i18n.t("games.alpha.x1_wins", { x1: (x > y ? a.names[0] : a.names[1]).toUpperCase().slice(0, 9) });
      ctx.cheer({ top: i18n.t("games.alpha.alphabet_game"), title, sub: i18n.t("games.alpha.x1_to_y", { x1: x, y }), speak: [ctx.LINES.alpha.done, "play:alpha:done"] });
    }
  }
  function toggleRun() {
    if (a.phase !== "play") return;
    a.hold = a.running;   // a pause the person asked for stays until they resume
    run(!a.running);
    snapshot();
    render();
    ctx.announce(a.running ? t("games.alpha.timer_is_running") : t("games.alpha.paused"));
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
      h("span", { class: "pl-sp-q" }, i18n.t("games.alpha.letter_x1_of_26", { x1: a.found.length + 1 })),
      h("span", { class: "pl-al-clock" }, icon("clock", "pl-ic"), timerEl)));
    if (teams) {
      host.append(h("ul", { class: "pl-al-teams", "aria-label": i18n.t("games.alpha.team_scores") }, [0, 1].map(i => h("li", { class: "pl-pchip" + (a.turn === i ? " turn" : ""), style: teamStyle(i),
        "aria-label": `${a.names[i]}, ${a.scores[i]} ${a.scores[i] === 1 ? i18n.t("games.alpha.point") : i18n.t("games.alpha.points")}${a.turn === i ? i18n.t("games.alpha.their_turn") : ""}` }, h("b", { "aria-hidden": "true" }, a.names[i]), h("span", { "aria-hidden": "true" }, a.scores[i])))));
      host.append(h("p", { class: "pl-turn", role: "status" }, h("b", null, i18n.t("games.alpha.x1_s_turn", { x1: a.names[a.turn] }))));
    }
    host.append(h("div", { class: "pl-al-sign" + (letterChanged ? " fresh" : ""), role: "img", "aria-label": i18n.t("games.alpha.the_letter_l", { l }) }, h("b", { "aria-hidden": "true" }, l)));
    host.append(h("h3", { class: "pl-qt pl-al-q" }, i18n.t("games.alpha.find_a_word_on_a_sign_that_starts_with", { l })));
    if (t) host.append(h("p", { class: "pl-al-tip" }, icon("info", "pl-ic"), h("span", null, t)));
    const strip = h("ol", { class: "pl-al-strip", "aria-label": i18n.t("games.alpha.length_of_26_letters_found", { length: a.found.length }) },
      LETTERS.map(x => h("li", { class: a.found.includes(x) ? "ok" : x === l ? "now" : "", "aria-hidden": "true" }, x)));
    host.append(strip);
    host.append(h("button", { class: "primary pl-al-found", type: "button", "data-k": "found", disabled: !a.running, onclick: safe(found, "found") }, icon("check"), i18n.t("games.alpha.found_it")));
    host.append(h("div", { class: "pl-row pl-al-acts" },
      ctx.canSpeak() ? h("button", { class: "secondary pl-tool", type: "button", "data-k": "say", "aria-label": i18n.t("games.alpha.say_the_letter_out_loud"), onclick: safe(speakLetter, "say") }, icon("speaker"), i18n.t("games.alpha.say_it")) : null,
      h("button", { class: "secondary pl-tool", type: "button", "data-k": "pass", disabled: !a.running, onclick: safe(pass, "pass") }, teams ? i18n.t("games.alpha.pass_to_the_other_team") : i18n.t("games.alpha.skip_for_now")),
      h("button", { class: "secondary pl-tool", type: "button", "data-k": "pause", "aria-pressed": String(!a.running), onclick: safe(toggleRun, "pause") }, a.running ? i18n.t("games.alpha.pause") : i18n.t("games.alpha.resume"))));
    if (!a.running) host.append(h("p", { class: "pl-al-paused", role: "status" }, i18n.t("games.alpha.paused_the_timer_waits_for_you")));
    host.append(h("button", { class: "link pl-skip2", type: "button", "data-k": "quit", onclick: safe(() => { run(false); a.phase = "ready"; rec.cur = null; saveRec(); render(); }, "quit") }, i18n.t("games.alpha.end_this_game")));
  }
  function renderReady() {
    const c = rec.cur;
    host.append(h("div", { class: "pl-sp-ready" },
      h("div", { class: "pl-sp-sign" }, h("span", { class: "pl-sp-kicker" }, t("games.alpha.signs_billboards_trucks")), h("b", null, t("games.alpha.a_to_z_2")), h("span", null, t("games.alpha.find_a_word_that_starts_with_each"))),
      h("div", { class: "seg wide pl-pl-seg", role: "group", "aria-label": t("games.alpha.who_is_playing") },
        ...[["solo", t("games.alpha.everyone_together")], ["teams", t("games.alpha.two_teams")]].map(([id, t]) => h("button", { type: "button", "data-mode": id, "aria-pressed": String(a.mode === id), onclick: safe(() => setMode(id), "mode") }, t)))));
    if (a.mode === "teams") {
      host.append(h("div", { class: "pl-al-names" }, [0, 1].map(i => h("label", { class: "pl-al-name", style: teamStyle(i) },
        h("span", { class: "pl-al-swatch", "aria-hidden": "true" }),
        h("span", { class: "pl-sr" }, t("games.alpha.name_for_team_x1", { x1: i + 1 })),
        h("input", { type: "text", value: a.names[i], maxlength: "12", autocomplete: "off", autocapitalize: "words", "aria-label": t("games.alpha.name_for_team_x1", { x1: i + 1 }),
          oninput: safe(e => { a.names[i] = e.target.value.slice(0, 12) || t("games.alpha.team_x1", { x1: i + 1 }); }, "name") })))));
      host.append(h("p", { class: "pl-why" }, t("games.alpha.teams_take_turns_the_team_on_turn")));
    } else {
      host.append(h("p", { class: "pl-why" }, t("games.alpha.everyone_looks_together_tap_found_it")));
    }
    host.append(h("p", { class: "pl-al-tip" }, icon("info", "pl-ic"), h("span", null, t("games.alpha.hard_ones_q_x_and_z_the_word_exit"))));
    if (c) host.append(h("div", { class: "pl-confirm pl-al-resume" }, h("p", null, t("games.alpha.a_game_is_waiting_length_of_26_found", { length: c.found.length, elapsed: fmtTime(c.elapsed) })),
      h("div", { class: "pl-row" }, h("button", { class: "primary", type: "button", "data-k": "resume", onclick: safe(() => start(true), "resume") }, t("games.alpha.pick_it_up")))));
    if (rec.best) host.append(h("p", { class: "pl-sp-best" }, t("games.alpha.best_time_fmttime_games_x1_finished", { fmtTime: fmtTime(rec.best * 1000), games: rec.games, x1: rec.games === 1 ? t("games.alpha.game") : t("games.alpha.games") })));
    host.append(h("button", { class: "primary pl-sp-go", type: "button", "data-k": "start", onclick: safe(() => start(false), "start") }, c ? t("games.alpha.start_over") : t("games.alpha.start_the_clock")));
  }
  function renderDone() {
    const teams = a.mode === "teams";
    const [x, y] = a.scores;
    host.append(h("div", { class: "pl-sp-done" },
      h("div", { class: "pl-sp-sign" },
        h("span", { class: "pl-sp-kicker" }, teams ? t("games.alpha.final_score") : a.newBest ? t("games.alpha.a_new_best_time") : t("games.alpha.you_made_it")),
        h("b", { class: "pl-sp-big" }, teams ? (x === y ? t("games.alpha.a_tie_2") : t("games.alpha.x1_wins_2", { x1: x > y ? a.names[0] : a.names[1] })) : fmtTime(a.elapsed)),
        h("span", null, teams ? `${a.names[0]} ${x}, ${a.names[1]} ${y} · ${fmtTime(a.elapsed)}` : t("games.alpha.a_to_z_x1", { x1: a.skips ? t("games.alpha.with_skips_x1", { skips: a.skips, x1: a.skips === 1 ? t("games.alpha.skip") : t("games.alpha.skips") }) : "" }))),
      !teams && rec.best ? h("p", { class: "pl-why" }, t("games.alpha.best_time_fmttime", { fmtTime: fmtTime(rec.best * 1000) })) : null,
      h("div", { class: "pl-row pl-sp-acts" },
        h("button", { class: "primary", type: "button", "data-k": "again", onclick: safe(() => { a.phase = "ready"; render(); }, "again") }, icon("shuffle"), t("games.alpha.play_again")),
        h("button", { class: "secondary", type: "button", onclick: safe(() => ctx.api.play.open("home"), "home") }, t("games.alpha.all_games")))));
  }

  render();
  return {
    show() { if (a.phase === "play") { if (!a.hold) run(true); snapshot(); } render(); },
    hide() { if (a.phase === "play") { run(false); snapshot(); } },
    start, found, pass, toggleRun, setMode,
    state: () => ({ phase: a.phase, mode: a.mode, letter: letter() || null, found: a.found.slice(), left: a.queue.length, running: a.running, elapsed: total(), scores: a.scores.slice(), turn: a.turn, best: rec.best, games: rec.games, hasCur: !!rec.cur }),
  };
}
