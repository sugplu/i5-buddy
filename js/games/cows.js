// Cow Count: the classic. Each side of the car counts the cows on its side of the road. A cemetery on your side sends
// your count back to zero (the other side keeps theirs). Buttons only: nothing is detected, nobody is tracked.
// Store key "cows": {l, r, best, games}: the two counts, the most cows either side ever reached, finished games.

import { t } from "../i18n.js";
export function create(ctx) {
  const { h, icon, safe, colorStyle } = ctx;
  const host = ctx.pane;
  const rec0 = () => { const r = ctx.store("cows", null); return r && typeof r === "object" ? r : {}; };
  let c = { l: Math.max(0, Math.round(ctx.num(rec0().l))), r: Math.max(0, Math.round(ctx.num(rec0().r))), best: Math.max(0, Math.round(ctx.num(rec0().best))), games: Math.max(0, Math.round(ctx.num(rec0().games))) };
  const save = () => ctx.save("cows", c);
  const undoStack = [];   // [{l, r, best}]
  const live = h("p", { class: "pl-sr", role: "status" });
  const SIDES = [["l", t("games.cows.left_side"), "gold"], ["r", t("games.cows.right_side"), "blue"]];
  const refs = {};
  let confirmEl = null;

  function push() { undoStack.push({ l: c.l, r: c.r, best: c.best }); if (undoStack.length > 50) undoStack.shift(); }
  function cow(side) {
    if (side !== "l" && side !== "r") return false;
    push();
    c[side]++;
    c.best = Math.max(c.best, c[side]);
    save(); paint(side, "bump");
    ctx.buzz(12);
    ctx.announce(`${name(side)}: ${c[side]}.`);
    return true;
  }
  function cemetery(side) {
    if (side !== "l" && side !== "r") return false;
    push();
    const was = c[side];
    c[side] = 0;
    save(); paint(side, "ghost");
    ctx.buzz([30, 40, 30]);
    ctx.announce(t("games.cows.cemetery_on_the_side_their_count_goes", { side: name(side).toLowerCase(), x1: was ? t("games.cows.from_was", { was }) : "" }));
    return true;
  }
  function undo() {
    const u = undoStack.pop();
    if (!u) return false;
    c.l = u.l; c.r = u.r; c.best = u.best;
    save(); paint();
    ctx.announce(t("games.cows.undone_left_l_right_r", { l: c.l, r: c.r }));
    return true;
  }
  function newGame() {
    if (c.l || c.r) c.games++;
    c.l = 0; c.r = 0;
    undoStack.length = 0;
    save(); paint();
    if (confirmEl) confirmEl.hidden = true;
    ctx.announce(t("games.cows.both_counts_are_back_to_zero"));
  }
  const name = side => SIDES.find(s => s[0] === side)[1];

  function build() {
    host.textContent = "";
    refs.undo = h("button", { class: "secondary pl-tool", type: "button", "data-k": "undo", onclick: safe(undo, "undo") }, icon("undo"), t("games.cows.undo"));
    refs.lead = h("p", { class: "pl-cow-lead", role: "status" });
    refs.best = h("p", { class: "pl-sp-best" });
    const cols = h("div", { class: "pl-cow-cols" }, SIDES.map(([k, label, col]) => {
      const n = h("output", { class: "pl-cow-n", "aria-label": t("games.cows.label_count", { label }) }, String(c[k]));
      const ghost = h("span", { class: "pl-cow-ghost", "aria-hidden": "true" }, "\u{1F47B}");
      refs[k] = { n, col: null, ghost };
      return h("section", { class: "pl-cow-col", style: colorStyle(col), "aria-label": label },
        h("h3", { class: "pl-cow-h" }, label),
        h("div", { class: "pl-cow-count" }, n, ghost),
        h("button", { class: "pl-cow-btn", type: "button", "data-k": "cow-" + k, "aria-label": t("games.cows.add_a_cow_on_the_label", { label: label.toLowerCase() }), onclick: safe(() => cow(k), "cow " + k) },
          h("span", { "aria-hidden": "true" }, "\u{1F404}"), h("b", null, t("games.cows.1_cow"))),
        h("button", { class: "pl-cow-grave", type: "button", "data-k": "grave-" + k, "aria-label": t("games.cows.cemetery_on_the_label_reset_its_count", { label: label.toLowerCase() }), onclick: safe(() => cemetery(k), "cemetery " + k) },
          h("span", { "aria-hidden": "true" }, "⚰️"), t("games.cows.cemetery")));
    }));
    confirmEl = h("div", { class: "pl-confirm", hidden: true, role: "group", "aria-label": t("games.cows.start_a_new_count") },
      h("p", null, t("games.cows.set_both_counts_back_to_zero")),
      h("div", { class: "pl-row" },
        h("button", { class: "secondary", type: "button", "data-k": "keep", onclick: () => { confirmEl.hidden = true; host.querySelector('[data-k="new"]').focus({ preventScroll: true }); } }, t("games.cows.keep_counting")),
        h("button", { class: "primary", type: "button", "data-k": "new-yes", onclick: safe(newGame, "new game") }, t("games.cows.new_count"))));
    host.append(h("p", { class: "pl-why" }, t("games.cows.count_the_cows_on_your_side_of_the_car")), cols, refs.lead,
      h("div", { class: "pl-row pl-cow-foot" }, refs.undo,
        h("button", { class: "secondary pl-tool", type: "button", "data-k": "new", onclick: safe(() => {
          if (!c.l && !c.r) return;
          confirmEl.hidden = false; confirmEl.querySelector("button.secondary").focus({ preventScroll: true });
          try { confirmEl.scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }
        }, "new count") }, icon("shuffle"), t("games.cows.new_count"))),
      confirmEl, refs.best, live);
    paint();
  }
  function paint(side, kind) {
    for (const [k] of SIDES) {
      refs[k].n.textContent = String(c[k]);
      if (k === side && kind) {
        const col = refs[k].n.closest(".pl-cow-col");
        col.classList.remove("bump", "ghost"); void col.offsetWidth; col.classList.add(kind);
      }
    }
    refs.undo.disabled = !undoStack.length;
    refs.lead.textContent = c.l === c.r ? (c.l ? t("games.cows.all_tied_at_l", { l: c.l }) : t("games.cows.nobody_has_seen_a_cow_yet")) : t("games.cows.x1_side_leads_by_x2", { x1: c.l > c.r ? t("games.cows.left") : t("games.cows.right"), x2: Math.abs(c.l - c.r) });
    refs.best.textContent = c.best ? t("games.cows.most_cows_on_one_side_best", { best: c.best }) : "";
    refs.best.hidden = !c.best;
  }

  build();
  return { show() { paint(); }, hide() {}, cow, cemetery, undo, newGame, state: () => ({ l: c.l, r: c.r, best: c.best, games: c.games, canUndo: undoStack.length > 0 }) };
}
