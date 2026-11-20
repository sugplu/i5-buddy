// The synthetic voice-command bank (tools/fixtures/listen-bank.json): about 3,000 things people say in the car, each
// with the command the app should run. Pure: tools/test-listen.html runs it in the browser, tools/listen_bank.mjs in
// node (quick runs while tuning listen.js rules). Nothing here is heard.
//
// Rows: {t: text, cmd, arg, g: group, s: style, key?, i?} where an "ask" row names the I5ASK entry (key) and question
// (i) it means; a row that says "it" or "this place" (named: false) runs with that entry as the place in front of us.
// Every other row runs with a typical moment of a drive: near mile 309 (Kettleman City), heading north, the landmark
// on the Drive card as "it". So the bank also catches Ask Buddy taking over a question another command should answer.

const norm = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The context every row runs in. */
export function bankContext(L, data, ask, m = 309, dir = "N") {
  const places = (data.places || []).map(p => p.name);
  const dests = (data.dests || []).map(d => d.name);
  const ahead = x => (dir === "S" ? m - x : x - m);
  const near = (data.places || []).filter(p => ahead(p.m) > -3 && ahead(p.m) < 15).map(p => ({ name: p.name, side: "", d: ahead(p.m) }));
  const card = (data.places || []).filter(p => ahead(p.m) >= 0).sort((a, b) => ahead(a.m) - ahead(b.m))[0];
  const zone = (data.zones || []).find(z => m >= z.from && m < z.to);
  const idx = ask ? L.askIndex(ask) : null;
  return { places, dests, dir, near, idx, here: card ? [card.id] : [], zone: zone ? "z:" + zone.from : null };
}

/** Did the parser do what the row expects? */
export function rowPass(row, got) {
  // an Ask Buddy question: that place's answer, or (for "who was X", "what is X") its whole story
  if (row.cmd === "ask") return (got.cmd === "ask" && (got.arg === row.key || got.arg === row.link)) || (got.cmd === "more" && !!row.name && [got.arg, ...(got.cands || [])].some(x => norm(x) === norm(row.name)));
  if (got.cmd !== row.cmd) return false;
  const want = row.arg;
  if (want == null || want === "") return true; // the label names no argument: any is fine
  if (typeof want === "boolean" || typeof got.arg === "boolean") return String(got.arg) === String(want);
  if (row.cmd === "howfar") {
    // "Oregon border" / "Mexico border": the app answers those as the end of the road (st), any form is right
    if (/border$/i.test(want)) return !!got.st || norm(got.arg) === norm(want);
    return norm(got.arg) === norm(want) || norm(got.past) === norm(want);
  }
  if (row.cmd === "distance" || row.cmd === "more") return [got.arg, ...(got.cands || [])].some(x => norm(x) === norm(want));
  if (row.cmd === "answer") return String(got.arg) === String(want);
  return norm(got.arg) === norm(want);
}

/** Run the bank: totals, by group and by command, and every failure. */
export function runBank(rows, L, ctx) {
  const res = { total: 0, pass: 0, ask: { total: 0, pass: 0, exact: 0, named: [0, 0], here: [0, 0] }, stolen: 0, byGroup: {}, byCmd: {}, fails: [] };
  for (const row0 of rows) {
    const askRow = row0.cmd === "ask";
    const E = askRow && ctx.idx ? ctx.idx.byKey.get(row0.key) : null;
    const row = E ? Object.assign({}, row0, { name: E.name, link: E.link }) : row0;
    const here = askRow && row.named === false ? [row.key] : ctx.here;
    const opts = { places: ctx.places, dir: ctx.dir, near: ctx.near, ask: ctx.idx ? { idx: ctx.idx, here, zone: ctx.zone } : null };
    const got = L.chooseCommand([row.t], ctx.dests, opts);
    const ok = rowPass(row, got);
    res.total++; if (ok) res.pass++;
    const g = res.byGroup[row.g] || (res.byGroup[row.g] = [0, 0]); g[1]++; if (ok) g[0]++;
    const c = res.byCmd[row.cmd] || (res.byCmd[row.cmd] = [0, 0]); c[1]++; if (ok) c[0]++;
    if (askRow) {
      res.ask.total++; if (ok) res.ask.pass++; if (ok && got.i === row.i) res.ask.exact++;
      const k = row.named === false ? "here" : "named"; res.ask[k][1]++; if (ok) res.ask[k][0]++;
    } else if (got.cmd === "ask") res.stolen++; // Ask Buddy answered something another command should have
    if (!ok) res.fails.push({ t: row.t, g: row.g, cmd: row.cmd, arg: row.arg, key: row.key, got: got.cmd, gotArg: got.arg === undefined ? null : got.arg, gotQ: got.q || null });
  }
  return res;
}
