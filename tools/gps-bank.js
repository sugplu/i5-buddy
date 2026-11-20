// I-5 Buddy GPS bank: runs the fixtures in tools/fixtures/gps/ (made by tools/gps_expand.py from the specs next to them)
// against the real app, each in its own hidden iframe, on simulated time (tools/simclock.js), silently.
//
// window.runGpsBank({ base: "fixtures/gps/", onResult(fx, res) }) -> [{name, family, pass, known, lines: [...]}]
//
// A fixture: {name, family, summary, points:[{t, lat, lon, acc, speed, heading?}], events:[{t, op}], expect:[{at_t, state}],
//             end_t, known_bug?}.  t is seconds from the start of the drive. Events: start (tap Start GPS), deny / allow (the
// location permission), call_start / call_end (the speech engine stalls: a phone call), restart (the page reloads; the
// drive is resumed by a tap, by itself, or not at all: resume = "tap" | "auto" | "none").
//
// A checkpoint state can ask (every key optional; all must hold):
//   mode: "off"|"gps"|"demo"           off_route: bool              mile: [mile, tolerance]    mile_null: true
//   dir: "N"|"S"                       dir_sure: bool               stale: bool (GPS signal lost)
//   pill: "GPS"|"GPS?"|"OFF I-5"|"THE END"|"OFF"|"NAV"             start_button: "Start GPS"|"Resume drive"
//   notices_include: [keys]            notices_exclude: [keys]      (keys: denied, precise, resume, demo-done, trip-saved)
//   status_re / card_re / card_not_re: case-insensitive regex on #statusText / #nextCard
//   said_re: [regex]                   something said since the last checkpoint matches each      (said = asked of voice.say)
//   not_said_re: [regex]               nothing said since the last checkpoint matches
//   max_said: n                        at most n lines said since the last checkpoint
//   speaking: bool                     queued_max: n
(function () {
  "use strict";
  const realSleep = ms => new Promise(r => setTimeout(r, ms));

  function newFrame() {
    const f = document.createElement("iframe");
    f.style.cssText = "position:absolute;left:-2000px;top:0;width:400px;height:800px;border:0";
    document.body.append(f);
    return f;
  }
  /** Load the app in the frame through tools/sim-boot.html, which sets up the simulated clock first (see simclock.js). */
  function boot(frame, ctx, permission, gapMs) {
    const S = window.I5Sim, n = (S.n || 0) + 1;
    S.next = { startMs: (ctx.clk ? ctx.clk.now : Date.now()) + (gapMs || 0), permission };  // a restart: the new page starts after the gap
    if (frame.contentWindow && frame.src) frame.contentWindow.location.replace("sim-boot.html"); else frame.src = "sim-boot.html";
    return n;
  }

  /** Wire a freshly booted app window: a fake GPS, quiet settings, the say() log. */
  async function wire(frame, ctx, n, resumeMode) {
    const win = frame.contentWindow;
    for (let i = 0; i < 400 && !(win.__simBootN === n && win.I5BUDDY); i++) await realSleep(25);
    if (!(win.__simBootN === n && win.I5BUDDY)) throw new Error("the app did not start");
    const api = win.I5BUDDY.api;
    win.__i5Errors = [];
    win.addEventListener("error", e => win.__i5Errors.push(String(e.message)));
    win.addEventListener("unhandledrejection", e => win.__i5Errors.push("rejection: " + String(e.reason && e.reason.message || e.reason)));
    const clk = window.I5Sim.last.clk;
    ctx.clk = clk; ctx.win = win; ctx.api = api;
    ctx.t0 = ctx.t0 == null ? clk.now : ctx.t0;
    ctx.eng = window.I5Sim.last.sp;
    const realSay = api.voice.say.bind(api.voice);
    api.voice.say = (text, opts = {}) => { ctx.said.push({ t: (clk.now - ctx.t0) / 1000, id: opts.id || null, text: String(text) }); return realSay(text, opts); };
    api.settings.narr = true; api.settings.zoneNarr = true; api.settings.chime = false; api.settings.live = false;
    const G = {
      cb: null, err: null, denied: false, n: 0,
      watchPosition(s, e) {
        this.cb = s; this.err = e;
        if (this.denied && e) win.setTimeout(() => e({ code: 1 }), 0);
        return ++this.n;
      },
      clearWatch() { this.cb = null; this.err = null; },
      fix(p) {
        if (this.denied || !this.cb) return;
        this.cb({ coords: { latitude: p.lat, longitude: p.lon, speed: p.speed == null ? null : p.speed, heading: p.heading == null ? null : p.heading, accuracy: p.acc == null ? 10 : p.acc }, timestamp: clk.now });
      },
      deny() { this.denied = true; if (this.err) this.err({ code: 1 }); },
      allow() { this.denied = false; },
    };
    if (ctx.geo) { G.denied = ctx.geo.denied; }
    ctx.geo = G;
    win.__I5_FAKE_GEO__ = G;
    await clk.advance(resumeMode === "auto" ? 2500 : 600); // module start-up timers (main.js autoResume waits 1.5 s)
  }

  function snapshot(ctx) {
    const { win, api } = ctx, S = api.S, doc = win.document;
    const txt = id => { const e = doc.getElementById(id); return e ? e.textContent.trim() : ""; };
    return {
      mode: S.mode, off_route: !!S.offRoute, mile: S.m, dir: S.dir, dir_sure: S.dirSure !== false, stale: !!S.gpsStale,
      pill: txt("statusPill"), status: txt("statusText"), start_button: txt("startGps"),
      notices: [...doc.querySelectorAll("#driveNotice .notice")].map(n => [...n.classList].find(c => /^notice-/.test(c) && c !== "notice").slice(7)),
      card: (doc.getElementById("nextCard") || { textContent: "" }).textContent.replace(/\s+/g, " ").trim(),
      speaking: api.voice.isSpeaking(), queued: api.voice.queued().length,
    };
  }

  /** Compare a snapshot with a checkpoint's wanted state; returns a list of problems (empty = holds). */
  function compare(want, snap, said) {
    const bad = [];
    const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);   // a checkpoint may give one string for a list
    const eq = (k, got) => { if (k in want && want[k] !== got) bad.push(`${k}: wanted ${JSON.stringify(want[k])}, got ${JSON.stringify(got)}`); };
    eq("mode", snap.mode); eq("off_route", snap.off_route); eq("dir", snap.dir); eq("dir_sure", snap.dir_sure); eq("stale", snap.stale);
    eq("pill", snap.pill); eq("start_button", snap.start_button); eq("speaking", snap.speaking);
    if ("mile" in want) {
      const [m, tol] = want.mile;
      if (snap.mile == null || Math.abs(snap.mile - m) > tol) bad.push(`mile: wanted ${m} +-${tol}, got ${snap.mile == null ? "none" : snap.mile.toFixed(2)}`);
    }
    if (want.mile_null && snap.mile != null) bad.push(`mile: wanted none, got ${snap.mile.toFixed(2)}`);
    for (const k of arr(want.notices_include)) if (!snap.notices.includes(k)) bad.push(`notice "${k}" not showing (showing: ${snap.notices.join(", ") || "none"})`);
    for (const k of arr(want.notices_exclude)) if (snap.notices.includes(k)) bad.push(`notice "${k}" is showing`);
    if (want.status_re && !new RegExp(want.status_re, "i").test(snap.status)) bad.push(`status line /${want.status_re}/ vs "${snap.status}"`);
    if (want.card_re && !new RegExp(want.card_re, "i").test(snap.card)) bad.push(`card /${want.card_re}/ vs "${snap.card.slice(0, 100)}"`);
    if (want.card_not_re && new RegExp(want.card_not_re, "i").test(snap.card)) bad.push(`card must not match /${want.card_not_re}/: "${snap.card.slice(0, 100)}"`);
    for (const r of arr(want.said_re)) if (!said.some(s => new RegExp(r, "i").test(s.text))) bad.push(`nothing said matching /${r}/ (said ${said.length}: ${said.map(s => s.id || s.text.slice(0, 30)).join(", ").slice(0, 120)})`);
    for (const r of arr(want.not_said_re)) { const hit = said.find(s => new RegExp(r, "i").test(s.text)); if (hit) bad.push(`said something matching /${r}/: "${hit.text.slice(0, 80)}"`); }
    if (want.max_said != null && said.length > want.max_said) bad.push(`said ${said.length} lines, at most ${want.max_said}: ${said.map(s => s.id || s.text.slice(0, 30)).join(", ").slice(0, 160)}`);
    if (want.queued_max != null && snap.queued > want.queued_max) bad.push(`${snap.queued} lines queued, at most ${want.queued_max}`);
    return bad;
  }

  async function runFixture(fx) {
    try { localStorage.clear(); } catch {}
    const frame = newFrame();
    const ctx = { said: [], clk: null, t0: null, win: null, api: null, geo: null, eng: null };
    const res = { name: fx.name, family: fx.family, pass: true, known: !!fx.known_bug, known_bug: fx.known_bug || "", lines: [] };
    try {
      await wire(frame, ctx, boot(frame, ctx, "prompt"), null);
      const items = [];
      for (const e of fx.events || []) items.push({ t: e.t, o: 0, k: "ev", e });
      for (const p of fx.points) items.push({ t: p.t, o: 1, k: "pt", p });
      (fx.expect || []).forEach((c, i) => items.push({ t: c.at_t, o: -1, k: "chk", c, i }));
      items.sort((a, b) => a.t - b.t || a.o - b.o);
      let saidFrom = 0;
      for (const it of items) {
        const dt = it.t * 1000 - (ctx.clk.now - ctx.t0);
        if (dt > 0) await ctx.clk.advance(dt);
        const api = ctx.api;
        if (it.k === "pt") { ctx.geo.fix(it.p); await ctx.clk.advance(0); }
        else if (it.k === "ev") {
          const op = it.e.op;
          if (op === "start") { api.startGps(); await ctx.clk.advance(0); }
          else if (op === "deny") ctx.geo.deny();
          else if (op === "allow") ctx.geo.allow();
          else if (op === "call_start") ctx.eng.setStall(true);
          else if (op === "call_end") ctx.eng.setStall(false);
          else if (op === "restart") {
            const was = ctx.geo.denied;
            const resume = it.e.resume || (it.e.tap === false ? "none" : "tap");
            await wire(frame, ctx, boot(frame, ctx, resume === "auto" ? "granted" : "prompt", (it.e.gap_s || 0) * 1000), resume);
            ctx.geo.denied = was;
            if (resume === "tap") { ctx.api.startGps(); await ctx.clk.advance(0); }
          }
          await ctx.clk.advance(0);
        } else {
          await ctx.clk.advance(300);
          const snap = snapshot(ctx);
          const said = ctx.said.slice(saidFrom);
          saidFrom = ctx.said.length;
          const bad = compare(it.c.state, snap, said);
          if (bad.length) { res.pass = false; res.lines.push(`@${it.t}s (${it.c.why || "checkpoint " + (it.i + 1)}): ${bad.join("; ")}`); }
        }
      }
      await ctx.clk.advance(Math.max(0, (fx.end_t || 0) * 1000 - (ctx.clk.now - ctx.t0)));
      const errs = ctx.win.__i5Errors || [];
      if (errs.length) { res.pass = false; res.lines.push("script errors: " + errs.slice(0, 2).join(" | ")); }
    } catch (e) {
      res.pass = false;
      res.lines.push("runner error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" / ") : e));
    } finally {
      frame.remove();
      try { localStorage.clear(); } catch {}
    }
    return res;
  }

  window.runGpsBank = async function (opts = {}) {
    const base = opts.base || "fixtures/gps/";
    const idx = await (await fetch(base + "index.json")).json();
    const out = [];
    for (const row of idx) {
      if (opts.filter && !opts.filter(row)) continue;
      const fx = await (await fetch(base + row.name + ".json")).json();
      const res = await runFixture(fx);
      out.push(res);
      if (opts.onResult) opts.onResult(fx, res);
    }
    return out;
  };
})();
