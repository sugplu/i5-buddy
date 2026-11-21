// Car Party: one scoreboard shared by the games. 2 to 6 players with names and colors, whose turn it is, and scores.
// Saved under the store key "party": {on, players: [{n, c, s}], turn}. Pass-and-play: nothing here needs a network or an account.
import { t } from "../i18n.js";
import { h, icon, colorStyle, COLORS, safe, shuffle, num, clamp } from "./kit.js";

export const MIN_PLAYERS = 2, MAX_PLAYERS = 6;
const DEFAULT_COLORS = ["gold", "blue", "pink", "green", "orange", "purple"];

export function createParty(ctx) {
  const listeners = new Set();
  const strips = new Set();
  let st = { on: false, players: [], turn: 0 };

  const clean = raw => {
    const r = raw && typeof raw === "object" ? raw : {};
    const players = (Array.isArray(r.players) ? r.players : []).slice(0, MAX_PLAYERS).map((p, i) => ({
      n: String(p && p.n != null ? p.n : "").slice(0, 14) || t("games.party.player_x1", { x1: i + 1 }),
      c: COLORS.some(c => c[0] === (p && p.c)) ? p.c : DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      s: Math.max(0, Math.round(num(p && p.s))),
    }));
    return { on: !!r.on && players.length >= MIN_PLAYERS, players, turn: players.length ? clamp(Math.round(num(r.turn)), 0, players.length - 1) : 0 };
  };
  const load = () => { st = clean(ctx.store("party", null)); };
  const save = () => { ctx.save("party", { on: st.on, players: st.players.map(p => ({ n: p.n, c: p.c, s: p.s })), turn: st.turn }); };
  const emit = () => {
    for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error("[play] party listener", e); } }
    for (const el of [...strips]) { if (!el.isConnected) { strips.delete(el); continue; } paintStrip(el); }
  };
  const changed = () => { save(); emit(); };

  const active = () => st.on && st.players.length >= MIN_PLAYERS;
  const players = () => st.players.map((p, i) => ({ ...p, i }));
  const current = () => (active() ? { ...st.players[st.turn], i: st.turn } : null);

  function setPlayers(n) {
    n = clamp(Math.round(n), MIN_PLAYERS, MAX_PLAYERS);
    while (st.players.length < n) {
      const i = st.players.length;
      const used = new Set(st.players.map(p => p.c));
      st.players.push({ n: t("games.party.player_x1", { x1: i + 1 }), c: DEFAULT_COLORS.find(c => !used.has(c)) || DEFAULT_COLORS[i % DEFAULT_COLORS.length], s: 0 });
    }
    st.players.length = Math.min(st.players.length, n);
    st.turn = clamp(st.turn, 0, st.players.length - 1);
    changed();
  }
  function start(n) {
    if (st.players.length < MIN_PLAYERS) { setPlayers(n || 2); }
    st.on = true;
    changed();
  }
  function stop() { st.on = false; changed(); }
  function award(pts, i = st.turn) {
    const p = st.players[i];
    if (!p || !active()) return 0;
    p.s = Math.max(0, p.s + Math.round(num(pts)));
    changed();
    return p.s;
  }
  function advance() {
    if (!active()) return null;
    st.turn = (st.turn + 1) % st.players.length;
    changed();
    return current();
  }
  function setTurn(i) { if (st.players[i]) { st.turn = i; changed(); } }
  function resetScores() { for (const p of st.players) p.s = 0; changed(); }
  function pickStarter() { if (st.players.length) { st.turn = Math.floor(Math.random() * st.players.length); changed(); } return current(); }
  /** Players in order of score, best first (ties keep seating order). */
  function standings() { return players().sort((a, b) => b.s - a.s || a.i - b.i); }
  /** The players holding the top score, or [] when nobody has scored. */
  function leaders() { const s = standings(); return s.length && s[0].s > 0 ? s.filter(p => p.s === s[0].s) : []; }

  /* ---------- the scoreboard strip: a compact row of colored chips that games show at their top ---------- */
  function paintStrip(el) {
    el.textContent = "";
    const on = active();
    el.hidden = !on;
    if (!on) return;
    const cur = st.turn;
    st.players.forEach((p, i) => {
      el.append(h("li", { class: "pl-pchip" + (i === cur && el.dataset.turns !== "off" ? " turn" : ""), style: colorStyle(p.c),
        "aria-label": `${p.n}, ${p.s} ${p.s === 1 ? t("games.party.point") : t("games.party.points")}${i === cur && el.dataset.turns !== "off" ? t("games.party.their_turn") : ""}` },
        h("b", { "aria-hidden": "true" }, p.n), h("span", { "aria-hidden": "true" }, p.s)));
    });
  }
  /** opts.turns false: do not mark whose turn it is (a game where everybody plays at once). */
  function strip(opts = {}) {
    const el = h("ul", { class: "pl-pstrip", "aria-label": t("games.party.car_party_scores") });
    if (opts.turns === false) el.dataset.turns = "off";
    strips.add(el);
    paintStrip(el);
    return el;
  }

  /* ---------- the setup panel ---------- */
  function panel(opts = {}) {
    const root = h("section", { class: "pl-party", "aria-label": t("games.party.car_party_setup") });
    const body = h("div", { class: "pl-party-body" });
    const live = h("p", { class: "pl-sr", role: "status" });
    let confirmEl = null;
    const say = t => { live.textContent = ""; setTimeout(() => { live.textContent = t; }, 30); };

    function draw() {
      const keepFocus = root.contains(document.activeElement) ? document.activeElement.getAttribute("data-k") : null;
      body.textContent = "";
      const n = st.players.length || 0;
      body.append(
        h("p", { class: "pl-party-lede" }, t("games.party.keep_score_for_2_to_6_players_games")),
        h("div", { class: "pl-stepper" },
          h("span", { class: "pl-stepper-l", id: "pl-party-nl" }, t("games.party.players")),
          h("button", { class: "secondary pl-step", type: "button", "data-k": "minus", "aria-label": t("games.party.fewer_players"), disabled: n <= MIN_PLAYERS,
            onclick: safe(() => { setPlayers(n - 1); say(t("games.party.length_players", { length: st.players.length })); draw(); }, "fewer") }, icon("minus")),
          h("output", { class: "pl-step-n", "aria-labelledby": "pl-party-nl" }, n || t("games.party.none")),
          h("button", { class: "secondary pl-step", type: "button", "data-k": "plus", "aria-label": t("games.party.more_players"), disabled: n >= MAX_PLAYERS,
            onclick: safe(() => { setPlayers(Math.max(n + 1, MIN_PLAYERS)); say(t("games.party.length_players", { length: st.players.length })); draw(); }, "more") }, icon("plus"))));
      if (!n) {
        body.append(h("button", { class: "primary pl-party-go", type: "button", "data-k": "start", onclick: safe(() => { start(2); say(t("games.party.car_party_is_on")); draw(); }, "start") }, t("games.party.start_a_car_party")));
        return;
      }
      const list = h("ul", { class: "pl-prows" });
      st.players.forEach((p, i) => {
        const input = h("input", { class: "pl-pname", type: "text", value: p.n, maxlength: "14", "data-k": "name" + i, autocomplete: "off", autocapitalize: "words",
          "aria-label": t("games.party.name_for_player_x1", { x1: i + 1 }),
          oninput: safe(e => { p.n = e.target.value.slice(0, 14); save(); emit(); }, "name") });
        input.addEventListener("blur", safe(() => { if (!p.n.trim()) { p.n = t("games.party.player_x1", { x1: i + 1 }); input.value = p.n; changed(); } }, "name blur"));
        const cname = (COLORS.find(c => c[0] === p.c) || COLORS[0])[1];
        list.append(h("li", { class: "pl-prow" + (i === st.turn && st.on ? " turn" : ""), style: colorStyle(p.c) },
          h("button", { class: "pl-pcolor", type: "button", "data-k": "color" + i, "aria-label": t("games.party.color_for_n_cname_tap_for_the_next", { n: p.n, cname }),
            onclick: safe(() => {
              const used = new Set(st.players.filter((_, j) => j !== i).map(x => x.c));
              const order = COLORS.map(c => c[0]);
              let k = order.indexOf(p.c);
              for (let t = 0; t < order.length; t++) { k = (k + 1) % order.length; if (!used.has(order[k])) break; }
              p.c = order[k]; changed(); draw();
            }, "color") }),
          input,
          h("button", { class: "secondary pl-padj", type: "button", "data-k": "dec" + i, "aria-label": t("games.party.take_a_point_from_n", { n: p.n }), disabled: p.s <= 0,
            onclick: safe(() => { p.s = Math.max(0, p.s - 1); changed(); draw(); }, "dec") }, icon("minus")),
          h("output", { class: "pl-pscore", "aria-label": t("games.party.s_points", { s: p.s }) }, p.s),
          h("button", { class: "secondary pl-padj", type: "button", "data-k": "inc" + i, "aria-label": t("games.party.give_a_point_to_n", { n: p.n }),
            onclick: safe(() => { p.s += 1; changed(); draw(); }, "inc") }, icon("plus"))));
      });
      body.append(list);
      const acts = h("div", { class: "pl-row pl-party-acts" },
        h("button", { class: "secondary", type: "button", "data-k": "first", onclick: safe(() => { const c = pickStarter(); say(c ? t("games.party.n_goes_first", { n: c.n }) : ""); draw(); }, "first") }, icon("shuffle"), t("games.party.who_goes_first")),
        h("button", { class: "secondary", type: "button", "data-k": "reset", onclick: safe(() => {
          if (st.players.every(p => p.s === 0)) return;
          confirmEl.hidden = false; confirmEl.querySelector("button.secondary").focus({ preventScroll: true });
        }, "reset") }, t("games.party.reset_scores")));
      confirmEl = h("div", { class: "pl-confirm", hidden: true, role: "group", "aria-label": t("games.party.reset_the_scores") },
        h("p", null, t("games.party.set_every_score_back_to_zero")),
        h("div", { class: "pl-row" },
          h("button", { class: "secondary", type: "button", "data-k": "keep", onclick: () => { confirmEl.hidden = true; root.querySelector('[data-k="reset"]').focus({ preventScroll: true }); } }, t("games.party.keep_scores")),
          h("button", { class: "primary", type: "button", "data-k": "reset-yes", onclick: safe(() => { resetScores(); confirmEl.hidden = true; say(t("games.party.scores_are_back_to_zero")); draw(); }, "reset yes") }, t("games.party.reset"))));
      body.append(acts, confirmEl);
      body.append(st.on
        ? h("button", { class: "secondary pl-party-go", type: "button", "data-k": "off", onclick: safe(() => { stop(); say(t("games.party.car_party_is_off")); draw(); }, "off") }, t("games.party.turn_the_car_party_off"))
        : h("button", { class: "primary pl-party-go", type: "button", "data-k": "start", onclick: safe(() => { start(n); say(t("games.party.car_party_is_on")); draw(); }, "start") }, t("games.party.start_the_car_party")));
      if (keepFocus) { const b = root.querySelector(`[data-k="${keepFocus}"]`); b && !b.disabled && b.focus({ preventScroll: true }); }
    }
    root.append(body, live);
    draw();
    const off = (() => { const fn = () => { if (!root.isConnected) { listeners.delete(fn); return; } /* names are typed here: do not redraw under the cursor */ };
      listeners.add(fn); return () => listeners.delete(fn); })();
    root.redraw = draw;
    root.dispose = off;
    return root;
  }

  load();
  return { load, save, active, players, current, award, advance, setTurn, resetScores, pickStarter, standings, leaders, strip, panel, start, stop,
    setPlayers, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); }, state: () => ({ on: st.on, turn: st.turn, players: players() }) };
}
