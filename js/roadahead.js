// I-5 Buddy "Road ahead" (module). Owns #roadAhead on the Drive tab: an elevation profile of the road in front of you with
// the hills tinted by steepness, the highest point, the steepest climb and descent (grade %), forecast points and traffic.
//
//   The chart   data.ELEV (feet at every whole corridor mile), read in your direction of travel: the next 50 miles, or
//               everything to your destination (to the end of the road when there is none). Before a trip starts it shows
//               the whole road from the Mexico border to the Oregon line, with its big climbs named.
//   Numbers     Climb (feet gained), Top (highest point and how far), Steepest (grade: feet per mile / 5280, smoothed over
//               3 miles). A visually hidden paragraph says the same for screen readers.
//   Along it    Your position (api.ride.svg() when the rides module has loaded, else a dot), forecasts from
//               api.live.weatherAlong() and incidents from the "traffic" bus event (tap one to read it).
// It redraws when you move half a mile, and when the settings, the traffic, the weather, the ride or the destination change.
// Nothing here uses the network. Colors come from the app.css tokens, so both themes work.

const W = 360, H = 200;               // chart coordinates (the svg scales to the screen; text and markers are HTML on top)
const XL = 18, XR = 342;              // left and right edge of the plot
const AHEAD = 50;                     // miles in the short view
const FT_MI = 5280;
const GRADE_MIN = 3;                  // label a climb or descent only when it is at least this steep (%)
const MOVE_MI = 0.5;                  // redraw after moving this far
const MAX_PTS = 160;                  // points drawn
const BACK = 0.3;                     // an incident this far behind still counts

let api = null, S = null, settings = null, bus = null, store = null, data = {}, ui = {};
let root = null, head = null, body = null, group = null, btnNear = null, btnTrip = null;
let mode = "near";                    // "near" (next 50 miles) | "trip" (to the destination or the end of the road)
let lastM = null, lastDir = null, lastSig = "", tab = "drive", dirty = true;
let traffic = [];                     // from the "traffic" bus event: corridor incidents with m
let sel = null;                       // the tapped marker: "tr:<first id>" | "wx:<m>"
let renders = 0, last = null;

const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function sv(tag, attrs, cls) {
  const e = document.createElementNS(SVGNS, tag);
  if (cls) e.setAttribute("class", cls);
  for (const k in attrs || {}) e.setAttribute(k, String(attrs[k]));
  return e;
}
/** A small warning triangle (decorative). */
function warnIcon() {
  const i = sv("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, "ra-warn");
  i.append(sv("path", { d: "M12 2.6 1.4 20.8h21.2L12 2.6Zm-1.1 6.6h2.2v6.1h-2.2V9.2Zm0 7.7h2.2v2.2h-2.2v-2.2Z", fill: "currentColor", "fill-rule": "evenodd" }));
  return i;
}
function warn(e) { try { console.warn("[roadahead]", (e && e.message) || e); } catch {} }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ft = n => `${Math.round(n).toLocaleString("en-US")} ft`;
const mi = d => (d < 0.5 ? "right here" : d < 1.5 ? "1 mi" : `${Math.round(d)} mi`);
const miWords = d => (d < 0.5 ? "right here" : d < 1.5 ? "about a mile" : `about ${Math.round(d)} miles`);

/* ---------- the road's shape ---------- */
const elevAt = m => (data.elevAt ? data.elevAt(m) : null);
function maxM() { return Number.isFinite(data.MAX_M) ? data.MAX_M : (data.ELEV ? data.ELEV.length - 1 : 797); }

/** Fine profile every mile: m0 is where it starts, sign +1 northbound / -1 southbound, L the length in miles.
    Returns {L, t[], e[] (feet), s[] (smoothed), g[] (grade %, 3-mile window, + = climbing)}. Pure given the data. */
function profile(m0, sign, L) {
  L = Math.max(1, L);
  const t = [], e = [];
  for (let x = 0; x < L; x++) t.push(x);
  t.push(L);
  for (const x of t) e.push(elevAt(clamp(m0 + sign * x, 0, maxM())));
  const s = e.map((v, i) => (i === 0 || i === e.length - 1 ? v : 0.25 * e[i - 1] + 0.5 * v + 0.25 * e[i + 1]));
  const g = t.map(x => {
    const a = Math.max(0, x - 1.5), b = Math.min(L, x + 1.5);
    const ea = elevAt(clamp(m0 + sign * a, 0, maxM())), eb = elevAt(clamp(m0 + sign * b, 0, maxM()));
    return b > a ? (eb - ea) / ((b - a) * FT_MI) * 100 : 0;
  });
  return { L, t, e, s, g };
}
/** A named spot near mile m: a pass, summit or peak in the places, else the landscape zone's name. */
function nameNear(m) {
  try {
    let best = null;
    for (const p of data.PLACES || []) {
      const d = Math.abs(p.m - m);
      if (d <= 2.5 && /\b(pass|summit|grade|peak|butte|mount|mountain|ridge|crags|hill)\b/i.test(p.name) && (!best || d < best.d)) best = { d, name: p.name };
    }
    if (best) return best.name;
    const z = data.zoneAt && data.zoneAt(m);
    return z ? z.label : null;
  } catch { return null; }
}
/** The run of miles around index i where the grade stays on the same side and at least `thr` steep. */
function runAround(g, i, sign, thr) {
  let a = i, b = i;
  while (a > 0 && g[a - 1] * sign >= thr) a--;
  while (b < g.length - 1 && g[b + 1] * sign >= thr) b++;
  return [a, b];
}
/** Feet climbed and descended, ignoring wiggles smaller than `thr` feet (the elevation data has a little noise at
    overpasses and cuts; adding up every small rise would inflate a flat road). */
function gain(e, thr) {
  let up = 0, down = 0, base = e[0], ext = e[0], trend = 0;
  for (let i = 1; i < e.length; i++) {
    const v = e[i];
    if (trend >= 0) {
      if (v > ext) ext = v;
      if (ext - v >= thr) { up += ext - base; trend = -1; base = ext; ext = v; }
    } else {
      if (v < ext) ext = v;
      if (v - ext >= thr) { down += base - ext; trend = 1; base = ext; ext = v; }
    }
  }
  if (trend >= 0) up += ext - base; else down += base - ext;
  return { up, down };
}
/** Facts about a profile: climb, top, steepest climb and descent. */
function analyse(pr, m0, sign) {
  const { e, s, g, t } = pr;
  const { up, down } = gain(s, pr.L > 80 ? 80 : 30);
  let topI = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[topI]) topI = i;
  let ci = 0, di = 0;
  for (let i = 1; i < g.length; i++) { if (g[i] > g[ci]) ci = i; if (g[i] < g[di]) di = i; }
  const mk = (i, sg) => {
    const pct = Math.abs(g[i]);
    if (pct < GRADE_MIN - 0.5) return null;
    const [a, b] = runAround(g, i, sg, Math.max(2, pct * 0.6));
    return { pct, i, d: t[i], a: t[a], b: t[b], len: Math.max(3, t[b] - t[a] + 1), m: m0 + sign * t[i] };
  };
  const climb = mk(ci, 1), desc = mk(di, -1);
  const lo = Math.min(...e), hi = Math.max(...e);
  return {
    up, down, top: { ft: e[topI], d: t[topI], m: m0 + sign * t[topI], name: nameNear(m0 + sign * t[topI]) },
    climb, desc, lo, hi,
    steep: climb && (!desc || climb.pct >= desc.pct) ? { ...climb, kind: "climb" } : desc ? { ...desc, kind: "descent" } : null,
  };
}
/** The few biggest summits in a long view (the whole road, or all the way to a destination). Local highs that stand
    well above the land around them, highest first. */
function summits(pr, m0, sign, n = 3) {
  const { e, t } = pr, out = [];
  for (let i = 3; i < e.length - 3; i++) {
    let hi = true, lo = Infinity;
    for (let k = -12; k <= 12; k++) { const v = e[i + k]; if (v === undefined) continue; if (v > e[i]) { hi = false; break; } }
    if (!hi) continue;
    for (let k = -40; k <= 40; k++) { const v = e[i + k]; if (v !== undefined) lo = Math.min(lo, v); }
    if (e[i] - lo >= 900) out.push({ i, d: t[i], ft: e[i], m: m0 + sign * t[i], prom: e[i] - lo });
  }
  return out.sort((a, b) => b.prom - a.prom).slice(0, n).sort((a, b) => a.d - b.d).map(p => ({ ...p, name: nameNear(p.m) }));
}
const stepClass = pct => (pct < 2 ? 0 : pct < 4 ? 1 : pct < 6 ? 2 : 3);
const STEP_WORD = ["easy", "moderate", "steep", "very steep"];

/* ---------- what is shown ---------- */
function destAhead() {
  const d = S && S.dest;
  if (!d || S.m == null || !Number.isFinite(d.m)) return null;
  const x = dirAhead(d.m);
  return x > 2 ? { name: String(d.name || "your destination"), d: x } : null;
}
const dirAhead = x => (S.dir === "N" ? x - S.m : S.m - x);
function endAhead() { return S.dir === "N" ? maxM() - S.m : S.m; }
const endName = () => {
  const E = data.ENDS && data.ENDS[S.dir === "N" ? "N" : "S"];
  return E ? E.short : "the end of the road";
};

/** What to draw right now: {pre, m0, sign, L, ...}. */
function plan() {
  if (!data.ELEV || !data.ELEV.length) return null;
  if (S.m == null) return { pre: true, m0: 0, sign: 1, L: maxM(), label: "The whole road" };
  const sign = S.dir === "N" ? 1 : -1;
  const rest = Math.max(1, endAhead());
  const dest = destAhead();
  const tripL = Math.min(rest, dest ? dest.d : rest);
  const canToggle = tripL > AHEAD + 2;
  const useTrip = canToggle && mode === "trip";
  const L = useTrip ? tripL : Math.min(AHEAD, rest);
  return { pre: false, m0: S.m, sign, L, trip: useTrip, canToggle, tripName: dest ? dest.name : endName(), tripL, rest,
    label: useTrip ? `To ${dest ? dest.name : endName()}` : `Next ${Math.round(L)} miles` };
}

function rideNode() {
  try {
    const r = api && api.ride;
    if (r && typeof r.svg === "function") {
      const v = r.svg({ size: 46, facing: "right", zz: false });   // rides.js: <svg> element, faces right like the chart runs
      if (v && v.nodeType === 1) return v.cloneNode(true);
      if (typeof v === "string" && /^\s*<svg/i.test(v)) {
        const tpl = document.createElement("template");
        tpl.innerHTML = v.trim();
        const n = tpl.content.firstElementChild;
        if (n) return n;
      }
    }
  } catch (e) { warn(e); }
  return null;
}
function weatherPoints(L, pre) {
  if (pre || settings.live !== true) return [];
  try {
    const f = api.live && api.live.weatherAlong;
    if (typeof f !== "function") return [];
    return (f() || []).map(w => ({ ...w, x: dirAhead(w.m) })).filter(w => w && Number.isFinite(w.x) && w.x >= 0 && w.x <= L + 0.5 && Number.isFinite(w.tempF));
  } catch (e) { warn(e); return []; }
}
const isRamp = it => /ramp/i.test(it.title || "");
function trafficPoints(L, pre) {
  if (pre || settings.live !== true) return [];
  return traffic.filter(it => it && Number.isFinite(it.m) && !isRamp(it) && (!it.dir || it.dir === S.dir)).map(it => ({ ...it, x: dirAhead(it.m) }))
    .filter(it => it.x >= -BACK && it.x <= L).sort((a, b) => a.x - b.x);
}
const isSevere = it => it.kind === "crash" || it.kind === "closure";
/** Group incidents that would sit on top of each other on the chart. */
function clusters(list, L) {
  const out = [];
  for (const it of list) {
    const x = XL + clamp(it.x, 0, L) / L * (XR - XL);
    const c = out[out.length - 1];
    if (c && x - c.x < 15) { c.items.push(it); c.severe = c.severe || isSevere(it); } else out.push({ x, items: [it], severe: isSevere(it) });
  }
  return out;
}
function trWords(it) {
  return `${it.title || "Traffic"}, ${mi(Math.max(0, it.x))}${it.x < 0.5 ? "" : " ahead"}${it.detail ? `. ${it.detail}` : ""}${it.until ? `. Until ${it.until}` : ""}`;
}

/* ---------- drawing ---------- */
function smoothPath(pts, close, yBase) {
  // quadratic curve through the midpoints of the polyline: round, no overshoot
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  d += `L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
  if (close) d += `L${l[0].toFixed(1)} ${yBase}L${pts[0][0].toFixed(1)} ${yBase}Z`;
  return d;
}
function niceStep(range) {
  for (const s of [100, 200, 250, 500, 1000, 2000]) if (range / s <= 4) return s;
  return 2000;
}
function xTicks(L, pre, endLabel) {
  if (pre) {
    const ends = data.ENDS || {};
    return [[0, (ends.S && ends.S.short) || "Start"], ...[200, 400, 600].filter(v => v < L - 60).map(v => [v, `${v}`]), [L, (ends.N && ends.N.short) || "End"]];
  }
  const step = L <= 60 ? 10 : L <= 150 ? 25 : L <= 320 ? 50 : 100;
  const out = [[0, "Now"]];
  for (let v = step; v < L - Math.max(step * 0.45, L * 0.12); v += step) out.push([v, `${v} mi`]);
  out.push([L, endLabel || `${Math.round(L)} mi`]);
  return out;
}
/** The label's width in chart units, roughly. */
const lw = (text, k = 5.6) => String(text).length * k + 14;

function render(force) {
  if (!root) return;
  const p = plan();
  if (!p) { root.hidden = true; return; }
  root.hidden = false;
  renders++;
  const sign = p.sign, m0 = p.m0, L = p.L;
  const pr = profile(m0, sign, L);
  const an = analyse(pr, m0, sign);
  const wx = weatherPoints(L, p.pre);
  const trf = clusters(trafficPoints(L, p.pre), L);
  const long = p.pre || p.L > 80;
  const flags = long ? summits(pr, m0, sign, 3) : (an.top.d >= 1.5 && an.top.ft - an.lo >= 250 && an.top.ft - pr.e[0] >= 120 ? [{ i: 0, d: an.top.d, ft: an.top.ft, m: an.top.m, name: an.top.name, prom: an.top.ft - an.lo }] : []);
  last = { pre: p.pre, mode: p.pre ? "pre" : p.trip ? "trip" : "near", L, m0, dir: S.dir, climb: Math.round(an.up), descent: Math.round(an.down), top: an.top, steep: an.steep, climbRun: an.climb, descRun: an.desc,
    flags: flags.map(f => ({ ft: f.ft, d: f.d, name: f.name })), weather: wx.length, traffic: trf.reduce((n, c) => n + c.items.length, 0), clusters: trf.length, renders };

  // y scale
  const lane = wx.length ? 38 : 0;
  const flagRows = flags.length ? (long && flags.length > 1 ? 2 : 1) : 0;
  const plotTop = lane + 26 + flagRows * 4 + (flags.length ? 22 : 0);
  const plotBot = H - 6;
  let lo = Math.min(...pr.s), hi = Math.max(...pr.s);
  if (hi - lo < 700) { const mid = (hi + lo) / 2; lo = mid - 350; hi = mid + 350; }
  if (lo < 0) { hi -= lo; lo = 0; }                      // nothing on I-5 is below sea level: no negative feet on the scale
  const yOf = v => plotBot - 16 - (v - lo) / (hi - lo) * (plotBot - 16 - plotTop);
  const xOf = x => XL + clamp(x, 0, L) / L * (XR - XL);
  const k = Math.max(1, Math.ceil(pr.L / MAX_PTS));
  const pts = [];
  for (let i = 0; i < pr.t.length; i += k) {
    let m = -Infinity, at = i;
    for (let j = i; j < Math.min(pr.t.length, i + k); j++) if (pr.s[j] > m) { m = pr.s[j]; at = j; }
    pts.push([xOf(pr.t[k === 1 ? i : at]), yOf(k === 1 ? pr.s[i] : m), i]);
  }
  if (pts[pts.length - 1][0] < XR - 0.5) pts.push([XR, yOf(pr.s[pr.s.length - 1]), pr.t.length - 1]);
  const lineD = smoothPath(pts, false), areaD = smoothPath(pts, true, H);

  // build the svg
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "ra-svg", "aria-hidden": "true", focusable: "false" });
  const defs = sv("defs");
  const fade = sv("linearGradient", { id: "raFade", x1: 0, y1: 0, x2: 0, y2: 1 });
  fade.append(sv("stop", { offset: 0, style: "stop-color:var(--surface);stop-opacity:0" }), sv("stop", { offset: 0.5, style: "stop-color:var(--surface);stop-opacity:.72" }), sv("stop", { offset: 0.92, style: "stop-color:var(--surface);stop-opacity:1" }));
  const sheen = sv("linearGradient", { id: "raSheen", x1: 0, y1: 0, x2: 0, y2: 1 });
  sheen.append(sv("stop", { offset: 0, style: "stop-color:var(--fg);stop-opacity:.22" }), sv("stop", { offset: 0.35, style: "stop-color:var(--fg);stop-opacity:0" }));
  const clip = sv("clipPath", { id: "raClip" });
  clip.append(sv("path", { d: areaD }));
  defs.append(fade, sheen, clip);
  svg.append(defs);
  // grid
  const stepFt = niceStep(hi - lo);
  for (let v = Math.ceil(lo / stepFt) * stepFt; v < hi; v += stepFt) {
    const y = yOf(v);
    if (y < plotTop + 12 || y > plotBot - 18) continue;
    svg.append(sv("line", { x1: XL, x2: XR, y1: y.toFixed(1), y2: y.toFixed(1) }, "ra-grid"));
    const t = sv("text", { x: XR, y: (y - 3).toFixed(1), "text-anchor": "end" }, "ra-gl");
    t.textContent = `${v.toLocaleString("en-US")} ft`;
    svg.append(t);
  }
  // tinted bands, clipped to the area
  const g = sv("g", { "clip-path": "url(#raClip)" });
  let run = null;
  const runs = [];
  const bandEnd = (x1, i1) => { if (run) { g.append(sv("rect", { x: run.x.toFixed(1), y: 0, width: Math.max(0.5, x1 - run.x + 0.6).toFixed(1), height: H }, "ra-b ra-b" + run.c)); runs.push({ c: run.c, i0: run.i, i1 }); run = null; } };
  for (let i = 0; i < pts.length - 1; i++) {
    const midI = Math.min(pr.g.length - 1, Math.round((pts[i][2] + pts[i + 1][2]) / 2));
    const c = stepClass(Math.abs(pr.g[midI]));
    if (!run || run.c !== c) { bandEnd(pts[i][0], i); run = { c, x: pts[i][0], i }; }
  }
  bandEnd(pts[pts.length - 1][0], pts.length - 1);
  g.append(sv("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#raFade)" }), sv("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#raSheen)" }));
  svg.append(g);
  svg.append(sv("path", { d: lineD }, "ra-glow"));
  for (const r of runs) svg.append(sv("path", { d: smoothPath(pts.slice(r.i0, Math.min(pts.length, r.i1 + 2))) }, "ra-seg ra-s" + r.c));
  svg.append(sv("path", { d: lineD }, "ra-line"));

  // markers (HTML on top of the svg, positioned in percent so they scale with it)
  const ov = el("div", "ra-ov");
  const pos = (node, x, y, extra) => { node.style.left = (x / W * 100).toFixed(2) + "%"; node.style.top = (y / H * 100).toFixed(2) + "%"; if (extra) node.style.cssText += extra; return node; };
  const lineY = x => { const i = clamp(Math.round(x / pr.L * (pr.t.length - 1)), 0, pr.s.length - 1); return yOf(pr.s[i]); };

  // grade labels sit low in the hill, with a thin leader up to the line
  const grades = [an.climb && { ...an.climb, kind: "up" }, an.desc && { ...an.desc, kind: "down" }].filter(Boolean).filter(r => !p.pre);
  if (long && !p.pre) { /* long views: still label the two steepest */ }
  let rowY = plotBot - 24, lastGx = -999;
  for (const r of grades.sort((a, b) => a.d - b.d)) {
    const text = `${Math.round(r.pct)}% grade, ${Math.round(r.len)} mi`;
    const w = lw(text, 5.4), cx = clamp(xOf((r.a + r.b) / 2), XL + 22 + w / 2, XR - w / 2);
    const y = Math.abs(cx - lastGx) < w + 6 ? rowY - 26 : rowY;
    lastGx = cx;
    const ly = lineY((r.a + r.b) / 2);
    svg.append(sv("line", { x1: cx.toFixed(1), x2: cx.toFixed(1), y1: (ly + 3).toFixed(1), y2: (y - 2).toFixed(1) }, "ra-lead"));
    const pill = el("span", "ra-grade " + (r.kind === "up" ? "up" : "down"));
    pill.append(el("i", null, r.kind === "up" ? "▲" : "▼"), document.createTextNode(` ${text}`));
    pill.setAttribute("aria-hidden", "true");
    ov.append(pos(pill, cx, y + 10));
  }
  // flags: the highest points
  let prevFlagX = -999, flagRow = 0;
  for (const f of flags) {
    const x = xOf(f.d), y = yOf(f.ft);
    const nm = f.name && f.name.length > 17 ? f.name.slice(0, 16).replace(/\s+\S*$/, "") || f.name.slice(0, 16) : f.name;
    const label = long && nm ? `${nm} · ${ft(f.ft)}` : ft(f.ft);
    const w = lw(label, 5.6);
    const cx = clamp(x, XL + w / 2, XR - w / 2);
    flagRow = Math.abs(cx - prevFlagX) < (w + 40) && prevFlagX > -999 ? flagRow ^ 1 : 0;
    prevFlagX = cx;
    const fy = plotTop - 14 - flagRow * 22;
    svg.append(sv("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: (fy + 8).toFixed(1), y2: (y - 1).toFixed(1) }, "ra-stem"), sv("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.2 }, "ra-peak"));
    const pill = el("span", "ra-flag", label);
    pill.setAttribute("aria-hidden", "true");
    ov.append(pos(pill, cx, fy));
  }
  // weather chips (top lane), nudged apart
  if (wx.length) {
    const items = wx.map(w => ({ w, x: xOf(w.x) })).sort((a, b) => a.x - b.x);
    for (let i = 1; i < items.length; i++) items[i].x = Math.max(items[i].x, items[i - 1].x + 48);
    for (let i = items.length - 1; i >= 0; i--) { const lim = i === items.length - 1 ? XR - 20 : items[i + 1].x - 48; if (items[i].x > lim) items[i].x = lim; }
    for (const it of items) {
      const w = it.w, id = "wx:" + Math.round(w.m);
      const b = el("button", "ra-pt ra-wx");
      b.type = "button";
      b.setAttribute("aria-pressed", String(sel === id));
      b.setAttribute("aria-label", `Forecast ${w.city ? "near " + w.city + ", " : ""}${miWords(Math.max(0, w.x))} ahead: ${Math.round(w.tempF)} degrees, ${w.short || "no description"}`);
      const v = el("span", "vis");
      v.append(el("i", null, w.emoji || w.icon || ""), el("b", null, `${Math.round(w.tempF)}°`));
      v.firstChild.setAttribute("aria-hidden", "true");
      b.append(v);
      b.addEventListener("click", () => select(id));
      ov.append(pos(b, it.x, 20));
      const sx = xOf(w.x);
      svg.append(sv("line", { x1: sx.toFixed(1), x2: sx.toFixed(1), y1: 38, y2: lineY(w.x).toFixed(1) }, "ra-tick"));
    }
  }
  // traffic
  for (const c of trf) {
    const first = c.items[0], id = "tr:" + first.id;
    const b = el("button", "ra-pt ra-tr" + (c.severe ? " severe" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(sel === id));
    b.setAttribute("aria-label", c.items.length > 1 ? `${c.items.length} traffic incidents, first ${trWords(first)}` : trWords(first));
    const v = el("span", "vis");
    if (c.items.length > 1) v.textContent = String(c.items.length); else v.append(warnIcon());
    b.append(v);
    b.addEventListener("click", () => select(id));
    ov.append(pos(b, c.x, lineY(clamp(first.x, 0, L))));
  }
  // you (before a trip there is no "you" on the road: mile 0 would put the ride at the Mexico border)
  if (!p.pre) {
    const me = el("span", "ra-me");
    me.setAttribute("aria-hidden", "true");
    const ride = rideNode();
    if (ride) { me.classList.add("ride"); ride.classList.add("ra-ride"); me.append(ride); } else me.append(el("i"));
    ov.append(pos(me, xOf(0), lineY(0)));
  }

  const chart = el("div", "ra-chart");
  chart.append(svg, ov);
  // x axis
  const ax = el("div", "ra-axis");
  ax.setAttribute("aria-hidden", "true");
  for (const [x, label] of xTicks(L, p.pre, p.trip ? shortName(p.tripName, 11) : null)) {
    const s = el("span", null, label);
    const f = x / L;
    s.style.left = (xOf(x) / W * 100).toFixed(2) + "%";
    s.className = f < 0.04 ? "l" : f > 0.96 ? "r" : "";
    ax.append(s);
  }

  // numbers
  const stats = el("div", "ra-stats");
  const tile = (label, value, sub, cls, unit) => {
    const t = el("div", "ra-stat" + (cls ? " " + cls : ""));
    const b = el("b", unit || /%$/.test(value) ? null : "word", value);
    if (unit) b.append(el("em", null, unit));
    t.append(el("small", null, label), b, el("span", null, sub || ""));
    return t;
  };
  const num = n => Math.round(n).toLocaleString("en-US");
  const scope = p.pre ? "the whole road" : p.trip ? `to ${p.tripName}` : `next ${Math.round(L)} mi`;
  // a name only for a real high point (a flag is drawn); on a gentle stretch the nearest landscape name would mislead
  const named = long || flags.length > 0;
  const topSub = p.pre ? (an.top.name || `mile ${Math.round(an.top.m)}`) : an.top.d < 0.5 ? "right here" : `in ${mi(an.top.d)}${named && an.top.name && an.top.d >= 1.5 ? " · " + shortName(an.top.name) : ""}`;
  stats.append(
    an.up < 60 ? tile("CLIMB", "Flat", scope) : tile("CLIMB", num(an.up), an.down >= 60 ? `${ft(an.down)} down` : scope, "", " ft"),
    tile("TOP", num(an.top.ft), topSub, "", " ft"),
    an.steep ? tile("STEEPEST", `${Math.round(an.steep.pct)}%`, p.pre ? `${an.steep.kind === "climb" ? "climb" : "descent"}, ${Math.round(an.steep.len)} mi` : `${an.steep.kind === "climb" ? "climb" : "descent"} in ${mi(an.steep.d)}`, an.steep.kind) : tile("STEEPEST", "Gentle", "no hard hills"),
  );
  // legend
  const leg = el("ul", "ra-legend");
  leg.setAttribute("aria-label", "Steepness colors");
  ["Easy", "Moderate", "Steep", "Very steep"].forEach((w, i) => { const li = el("li", null, w); li.prepend(el("i", "ra-sw ra-b" + i)); leg.append(li); });
  // readout
  const read = el("p", "ra-read");
  read.setAttribute("aria-live", "polite");
  const selText = selectedText(wx, trf);
  read.textContent = selText || summaryLine(p, an);
  read.classList.toggle("sel", !!selText);
  // screen-reader paragraph
  const sr = el("p", "ra-sr", srText(p, an, wx, trf, named));

  body.replaceChildren(stats, chart, ax, leg, read, sr);
  // header bits
  head.querySelector(".ra-title").textContent = p.pre ? "The whole road" : "Road ahead";
  group.hidden = !p.canToggle;
  if (p.canToggle) {
    btnNear.textContent = `Next ${AHEAD} mi`;
    btnTrip.textContent = `To ${shortName(p.tripName, 14)}`;
    btnNear.setAttribute("aria-pressed", String(!p.trip));
    btnTrip.setAttribute("aria-pressed", String(!!p.trip));
  }
  lastM = S.m; lastDir = S.dir; lastSig = signature(); dirty = false;
}
const shortName = (s, n = 18) => (String(s).length > n ? String(s).slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : String(s));

function summaryLine(p, an) {
  if (p.pre) return "Tap Start GPS or a demo drive to see the road in front of you.";
  const bits = [];
  bits.push(an.up < 60 && an.down < 60 ? "Flat road ahead." : `Up ${ft(an.up)}, down ${ft(an.down)} over ${p.trip ? "the way to " + p.tripName : p.L === Math.round(p.L) ? Math.round(p.L) + " miles" : "the next miles"}.`);
  if (an.steep) bits.push(`Steepest: ${Math.round(an.steep.pct)}% ${an.steep.kind === "climb" ? "climb" : "descent"} in ${mi(an.steep.d)}.`);
  return bits.join(" ");
}
function selectedText(wx, trf) {
  if (!sel) return "";
  if (sel.startsWith("wx:")) {
    const w = wx.find(x => "wx:" + Math.round(x.m) === sel);
    return w ? `${w.city ? "Near " + w.city + ", " : ""}${miWords(Math.max(0, w.x))} ahead: ${Math.round(w.tempF)}°, ${String(w.short || "").toLowerCase()}.`.replace(/, \./, ".") : "";
  }
  const c = trf.find(x => "tr:" + x.items[0].id === sel);
  if (!c) return "";
  const lines = c.items.slice(0, 3).map(trWords);
  return lines.join(". ") + (c.items.length > 3 ? `. And ${c.items.length - 3} more.` : ".");
}
function select(id) {
  sel = sel === id ? null : id;
  render(true);
  const b = [...root.querySelectorAll(".ra-pt")].find(x => x.getAttribute("aria-pressed") === "true");
  if (b) { try { b.focus({ preventScroll: true }); } catch {} }
}
function srText(p, an, wx, trf, named) {
  const s = [];
  if (p.pre) s.push(`The whole road, from ${(data.ENDS && data.ENDS.S.long) || "the start"} to ${(data.ENDS && data.ENDS.N.long) || "the end"}.`);
  else s.push(`Road ahead, ${p.trip ? "to " + p.tripName : "the next " + Math.round(p.L) + " miles"}, ${S.dir === "N" ? "northbound" : "southbound"}.`);
  s.push(an.up < 60 ? "The road is flat." : `You climb ${Math.round(an.up).toLocaleString("en-US")} feet and descend ${Math.round(an.down).toLocaleString("en-US")} feet.`);
  s.push(`The highest point is ${Math.round(an.top.ft).toLocaleString("en-US")} feet${p.pre ? "" : an.top.d < 0.5 ? ", right here" : ", " + miWords(an.top.d) + " ahead"}${named && an.top.name ? ", at " + an.top.name : ""}.`);
  if (an.climb) s.push(`The steepest climb is a ${Math.round(an.climb.pct)} percent grade for ${Math.round(an.climb.len)} miles${p.pre ? ", near mile " + Math.round(an.climb.m) : ", starting " + miWords(an.climb.a) + " ahead"}.`);
  if (an.desc) s.push(`The steepest descent is a ${Math.round(an.desc.pct)} percent grade for ${Math.round(an.desc.len)} miles${p.pre ? ", near mile " + Math.round(an.desc.m) : ", starting " + miWords(an.desc.a) + " ahead"}.`);
  if (!an.climb && !an.desc) s.push("There are no hard hills.");
  for (const w of wx) s.push(`Forecast ${w.city ? "near " + w.city + ", " : ""}${miWords(Math.max(0, w.x))} ahead: ${Math.round(w.tempF)} degrees, ${String(w.short || "").toLowerCase()}.`);
  if (trf.length) s.push(`Traffic: ${trf.flatMap(c => c.items).slice(0, 4).map(trWords).join(". ")}.`);
  return s.join(" ");
}

/** Something that changes the picture, other than the mile: cheap to compare. */
function signature() {
  let w = "";
  try { const f = api.live && api.live.weatherAlong; if (settings.live === true && typeof f === "function") w = (f() || []).map(x => `${Math.round(x.m)}:${x.tempF}:${x.short}`).join(","); } catch {}
  const r = (() => { try { return api.ride && api.ride.get ? JSON.stringify(api.ride.get()) : ""; } catch { return ""; } })();
  return [S.m == null ? "pre" : S.dir, settings.live === true ? "live" : "off", mode, S.dest ? `${S.dest.name}@${S.dest.m}` : "", traffic.map(t => t.id).join(","), w, r, sel || ""].join("|");
}

/* ---------- events ---------- */
function onPos() {
  if (tab !== "drive") { dirty = true; return; }
  if (S.m == null) { if (lastM !== null || dirty) render(); return; }
  if (lastM == null || S.dir !== lastDir || Math.abs(S.m - lastM) >= MOVE_MI) render();
  else if (dirty || signature() !== lastSig) render();
}
function onTab(name) {
  tab = String(name || "");
  if (tab === "drive") { if (dirty || signature() !== lastSig || (S.m != null && (lastM == null || Math.abs(S.m - lastM) >= MOVE_MI))) render(); }
}
function refreshIfChanged() {
  if (tab !== "drive") { dirty = true; return; }
  if (signature() !== lastSig || dirty) render();
}
function setMode(m) {
  mode = m;
  store.set("roadahead:mode", m);
  render(true);
}

export function init(a) {
  try {
    api = a || {};
    S = api.S; settings = api.settings; bus = api.bus;
    store = api.store || { get: (k, f) => f, set() {}, del() {} };
    data = api.data || {}; ui = api.ui || {};
    root = document.getElementById("roadAhead");
    if (!root || !S || !settings || !bus) return;
    mode = store.get("roadahead:mode", "near") === "trip" ? "trip" : "near";
    root.classList.add("ra");
    head = el("div", "ra-head");
    const title = el("h2", "ra-title", "Road ahead");
    group = el("div", "ra-seg");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "How far to show");
    btnNear = el("button", null, `Next ${AHEAD} mi`); btnNear.type = "button";
    btnTrip = el("button", null, "To the end"); btnTrip.type = "button";
    btnNear.addEventListener("click", () => setMode("near"));
    btnTrip.addEventListener("click", () => setMode("trip"));
    group.append(btnNear, btnTrip);
    head.append(title, group);
    body = el("div", "ra-body");
    root.replaceChildren(head, body);
    // traffic may have arrived before this module started
    try { const f = api.live && api.live.traffic; if (typeof f === "function") traffic = f() || []; } catch {}
    bus.on("pos", () => { try { onPos(); } catch (e) { warn(e); } });
    bus.on("tab", n => { try { onTab(n); } catch (e) { warn(e); } });
    bus.on("settings", () => { try { refreshIfChanged(); } catch (e) { warn(e); } });
    bus.on("ride", () => { try { dirty = true; refreshIfChanged(); } catch (e) { warn(e); } });
    bus.on("live:update", () => { try { refreshIfChanged(); } catch (e) { warn(e); } });
    bus.on("traffic", e => {
      try { traffic = (e && Array.isArray(e.incidents) ? e.incidents : []); dirty = true; refreshIfChanged(); } catch (err) { warn(err); }
    });
    bus.on("trip:end", () => { try { dirty = true; refreshIfChanged(); } catch (e) { warn(e); } });
    document.addEventListener("visibilitychange", () => { try { if (!document.hidden) refreshIfChanged(); } catch {} });
    api.roadahead = { render: () => render(true), state: () => last, setMode, _profile: profile };
    render(true);
  } catch (e) { warn(e); }
}

export const _test = { gain, profile, analyse, summits, nameNear: n => nameNear(n), stepClass };
