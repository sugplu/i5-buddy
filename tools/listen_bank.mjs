#!/usr/bin/env node
// Quick run of the voice-command bank in node (no browser, nothing heard): node tools/listen_bank.mjs [--fails out.json]
// The same code as the "Command bank" table in tools/test-listen.html (tools/listen-bank.js).
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repo = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
globalThis.window = globalThis;
const load = f => new Function(fs.readFileSync(path.join(repo, f), "utf8"))();
load("data/i5.js");
load("data/ask.js");
const L = await import(url.pathToFileURL(path.join(repo, "js/listen.js")).href);
const B = await import(url.pathToFileURL(path.join(repo, "tools/listen-bank.js")).href);
const rows = JSON.parse(fs.readFileSync(path.join(repo, "tools/fixtures/listen-bank.json"), "utf8")).rows;
const ctx = B.bankContext(L, window.I5DATA, window.I5ASK);
const t0 = Date.now();
const r = B.runBank(rows, L, ctx);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "-") + "%";
console.log(`bank: ${r.pass}/${r.total} = ${pct(r.pass, r.total)} in ${Date.now() - t0} ms; ask ${r.ask.pass}/${r.ask.total} (exact question ${r.ask.exact}),` +
  ` named ${pct(...r.ask.named)}, "it" ${pct(...r.ask.here)}; ask took over ${r.stolen} other rows`);
for (const [g, [p, n]] of Object.entries(r.byGroup).sort()) console.log(`  ${g.padEnd(18)} ${String(p).padStart(4)}/${String(n).padEnd(4)} ${pct(p, n)}`);
const fi = process.argv.indexOf("--fails");
if (fi > 0) fs.writeFileSync(process.argv[fi + 1], JSON.stringify(r.fails, null, 1));
