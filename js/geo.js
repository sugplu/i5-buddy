// Position along I-5: snap a GPS fix to the corridor line and read off the corridor mile.
import { ROUTE } from "./data.js";

const CELL = 0.1; // degrees
const grid = new Map();
for (let i = 0; i < ROUTE.length - 1; i++) {
  const a = ROUTE[i], b = ROUTE[i + 1];
  const i0 = Math.floor(Math.min(a[1], b[1]) / CELL), i1 = Math.floor(Math.max(a[1], b[1]) / CELL);
  const j0 = Math.floor(Math.min(a[2], b[2]) / CELL), j1 = Math.floor(Math.max(a[2], b[2]) / CELL);
  for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) {
    const k = ci + ":" + cj;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
}

function segInfo(i, lat, lon) {
  const [m0, a0, o0] = ROUTE[i], [m1, a1, o1] = ROUTE[i + 1];
  const kx = 69.17 * Math.cos(lat * Math.PI / 180), ky = 69.0;
  const ax = (o0 - lon) * kx, ay = (a0 - lat) * ky, dx = (o1 - o0) * kx, dy = (a1 - a0) * ky;
  const L = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L));
  const px = ax + t * dx, py = ay + t * dy;
  return { dist: Math.hypot(px, py), m: m0 + t * (m1 - m0), i, bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
}

/**
 * Nearest point on I-5. Returns {m, dist (miles from the line), bearing (northbound direction there)}.
 * hint: previous corridor mile; when two stretches of road are equally close (switchbacks), prefer the one near the hint.
 */
export function locate(lat, lon, hint = null) {
  const ci = Math.floor(lat / CELL), cj = Math.floor(lon / CELL);
  let cand = null;
  for (const r of [1, 3, 8, 25]) {
    const s = new Set();
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      const g = grid.get((ci + di) + ":" + (cj + dj));
      if (g) for (const i of g) s.add(i);
    }
    if (s.size) { cand = s; break; }
  }
  if (!cand) return { m: null, dist: Infinity, bearing: 0 };
  let best = null;
  for (const i of cand) {
    const r = segInfo(i, lat, lon);
    let score = r.dist;
    if (hint != null) score += Math.min(0.5, Math.abs(r.m - hint) / 200); // tie-break toward continuity
    if (!best || score < best.score) best = { ...r, score };
  }
  return { m: best.m, dist: best.dist, bearing: best.bearing };
}

export function coordAt(m) {
  let lo = 0, hi = ROUTE.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ROUTE[mid][0] < m) lo = mid + 1; else hi = mid; }
  const i = Math.max(1, lo);
  const [m0, a0, o0] = ROUTE[i - 1], [m1, a1, o1] = ROUTE[i];
  const t = m1 === m0 ? 0 : Math.max(0, Math.min(1, (m - m0) / (m1 - m0)));
  return [a0 + t * (a1 - a0), o0 + t * (o1 - o0)];
}

/** Compass bearing of northbound I-5 at mile m. */
export function bearingAt(m) {
  const [a0, o0] = coordAt(Math.max(0, m - 0.3)), [a1, o1] = coordAt(m + 0.3);
  const kx = Math.cos(a0 * Math.PI / 180);
  return (Math.atan2((o1 - o0) * kx, a1 - a0) * 180 / Math.PI + 360) % 360;
}

/** Direction of travel from a GPS heading: "N" if heading roughly matches northbound I-5 there, "S" if opposite. */
export function dirFromHeading(heading, m) {
  if (heading == null || isNaN(heading) || m == null) return null;
  const diff = Math.abs(((heading - bearingAt(m)) % 360 + 540) % 360 - 180); // 0..180
  if (diff < 60) return "N";
  if (diff > 120) return "S";
  return null;
}

export function miles(lat1, lon1, lat2, lon2) {
  const R = 3958.8, toR = Math.PI / 180;
  const dLa = (lat2 - lat1) * toR, dLo = (lon2 - lon1) * toR;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Sun altitude in degrees (for automatic day/night theme). */
export function sunAltitude(lat, lon, date = new Date()) {
  const rad = Math.PI / 180;
  const d = date / 864e5 - 10957.5; // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) * rad - ra);
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

/** Next sunrise or sunset within 20 hours: {type: "sunrise"|"sunset", at: Date} (sun altitude crossing -0.83 deg). */
export function nextSunEvent(lat, lon, now = new Date()) {
  const H = -0.83;
  let prev = sunAltitude(lat, lon, now);
  for (let k = 1; k <= 20 * 30; k++) {          // 2-minute steps
    const t = new Date(+now + k * 120000);
    const a = sunAltitude(lat, lon, t);
    if ((prev - H) * (a - H) <= 0 && prev !== a) return { type: a > prev ? "sunrise" : "sunset", at: t };
    prev = a;
  }
  return null;
}
