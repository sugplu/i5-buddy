// I-5 Buddy: "Pick your ride". Eight original, hand-drawn-looking vehicles that ride along on the Drive sign, the map and
// the passport. Module contract: ARCHITECTURE.md. Owns #rideSlot (Drive sign), #rideRow (Settings > Display), #rideSheet.
//
//   api.ride.get()   -> {kind, color, badge, name}          the saved ride
//   api.ride.svg(o)  -> <svg> element (or markup with {markup: true}); o = {kind, color, badge, name, size, facing, rotate, zz}
//   api.ride.list()  -> {kinds: [{id, name}], colors: [{id, name, hex}]}
//   api.ride.set(p)  -> merge a change (validated), save, emit "ride"; api.ride.open() opens the picker
//   api.ride.state() -> "moving" | "idle" | "sleepy"  (and the bus event "ride:state" {state})
// The art is plain SVG with literal fills (a data: URL draws it on the passport share card, where CSS variables do not
// reach). Every vehicle faces right in a 120 x 80 box; facing "left" mirrors the body but never the badge.

const NS = "http://www.w3.org/2000/svg";
const KEY = "ride", SEEN_KEY = "rideInvited";
const OUT = "#2b2420";           // outline for every vehicle
const GLASS = "#d3ecf6", LAMP = "#fff4c2", TAIL = "#ff5a4a", METAL = "#bcc2c6", TIRE = "#2f2926", SKIN = "#ffe6bf";

export const COLORS = [
  { id: "sunny", name: "Sunny", hex: "#f5c332" },
  { id: "tomato", name: "Tomato", hex: "#e5483f" },
  { id: "tangerine", name: "Tangerine", hex: "#f08a3c" },
  { id: "mint", name: "Mint", hex: "#4cc79a" },
  { id: "sky", name: "Sky", hex: "#3fa7e0" },
  { id: "grape", name: "Grape", hex: "#8a63d2" },
  { id: "bubblegum", name: "Bubblegum", hex: "#f58bb5" },
  { id: "snow", name: "Snow", hex: "#f4f1e8" },
];
export const KINDS = [
  { id: "compact", name: "Compact car" },
  { id: "camper", name: "Camper van" },
  { id: "pickup", name: "Pickup truck" },
  { id: "convertible", name: "Convertible" },
  { id: "rv", name: "Motorhome" },
  { id: "moto", name: "Motorcycle" },
  { id: "ev", name: "EV hatchback" },
  { id: "bus", name: "Family bus" },
];
const DEFAULT = { kind: "compact", color: "sunny", badge: "", name: "" };
const EMOJI_CHOICES = ["😎", "🌴", "⭐", "🐶", "🎸", "☀️", "🚀", "❤️"];
const MOVING_MPH = 3;             // at or above this speed the ride is "moving"
const NAME_MAX = 20;

/* ---------- small helpers ---------- */
const num = Number.isFinite;
const warn = e => { try { console.warn("[ride]", e && e.message ? e.message : e); } catch {} };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r1 = v => Math.round(v * 10) / 10;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const c = s => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return "#" + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
}
const colorOf = id => COLORS.find(c => c.id === id) || COLORS[0];
const kindOf = id => KINDS.find(k => k.id === id) || KINDS[0];

/** One emoji, or up to two letters or digits. Anything else is dropped. */
export function cleanBadge(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let m = null;
  try { m = s.match(/^\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/u); } catch {}
  if (m) return m[0];
  let letters = "";
  try { letters = (s.match(/[\p{L}\p{N}]/gu) || []).slice(0, 2).join(""); } catch { letters = s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2); }
  return letters.toUpperCase();
}
export function cleanName(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
}
export function cleanRide(r) {
  r = r && typeof r === "object" ? r : {};
  return {
    kind: KINDS.some(k => k.id === r.kind) ? r.kind : DEFAULT.kind,
    color: COLORS.some(c => c.id === r.color) ? r.color : DEFAULT.color,
    badge: cleanBadge(r.badge),
    name: cleanName(r.name),
  };
}
export const describe = r => `${colorOf(r.color).name} ${kindOf(r.kind).name.toLowerCase()}`;

/* ---------- the art ---------- */
const wheel = (cx, cy = 57, r = 9.5) =>
  `<g class="ride-wheel"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${TIRE}" stroke="${OUT}" stroke-width="2.4"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${r * 0.52}" fill="#e8ebec" stroke="${OUT}" stroke-width="1.6"/>` +
  `<path d="M${cx - r * 0.5} ${cy}H${cx + r * 0.5}M${cx} ${cy - r * 0.5}V${cy + r * 0.5}" stroke="${OUT}" stroke-width="1.5" stroke-linecap="round"/></g>`;
const arch = (cx, r = 12.4, cy = 57) => `<path d="M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z" fill="${OUT}" opacity=".9"/>`;
const SW = `stroke="${OUT}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const SWS = `stroke="${OUT}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"`;
const glass = d => `<path d="${d}" fill="${GLASS}" ${SWS}/>`;
/** A headlight "eye": a round lamp with a highlight, and a lid (shown only when the ride is sleepy). */
const eye = (cx, cy, r, c) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${LAMP}" ${SWS}/><circle cx="${r1(cx + r * 0.25)}" cy="${r1(cy - r * 0.15)}" r="${r1(r * 0.34)}" fill="${OUT}"/>` +
  `<path class="ride-lid" opacity="0" d="M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z" fill="${c.D}" ${SWS}/>`;
const tail = (x, y, w = 4.5, h = 7) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${TAIL}" stroke="${OUT}" stroke-width="1.5"/>`;
const smile = d => `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="2" stroke-linecap="round"/>`;

/** The driver: a round face (two dots and a smile), or the badge in its place. */
function driver(h, c) {
  const { x, y, r } = h;
  let inner;
  if (c.badge) {
    const emoji = /\p{Extended_Pictographic}/u.test(c.badge);
    const fs = emoji ? r * 1.45 : (c.badge.length > 1 ? r * 1.05 : r * 1.3);
    inner = `<text transform="translate(${x} ${y + fs * 0.06}) scale(${c.flip ? -1 : 1} 1)" text-anchor="middle" dominant-baseline="central" ` +
      `font-size="${r1(fs)}" font-weight="800" fill="${OUT}" font-family="Overpass,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',system-ui,sans-serif">${esc(c.badge)}</text>`;
  } else {
    inner = `<circle cx="${r1(x - r * 0.36)}" cy="${r1(y - r * 0.12)}" r="${r1(r * 0.13)}" fill="${OUT}"/><circle cx="${r1(x + r * 0.36)}" cy="${r1(y - r * 0.12)}" r="${r1(r * 0.13)}" fill="${OUT}"/>` +
      `<path d="M${r1(x - r * 0.42)} ${r1(y + r * 0.28)}Q${x} ${r1(y + r * 0.72)} ${r1(x + r * 0.42)} ${r1(y + r * 0.28)}" fill="none" stroke="${OUT}" stroke-width="1.3" stroke-linecap="round"/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${SKIN}" stroke="${OUT}" stroke-width="1.6"/>` + inner;
}

const ART = {
  compact: c => `
    ${arch(32)}${arch(86)}
    <path d="M28 38C30 25 38 20 52 20H70C82 20 90 27 97 38Z" fill="${c.B}" ${SW}/>
    ${glass("M33 36C35 28 40 24 50 24H58V36Z")}${glass("M63 24H70C78 24 83 29 88 36H63Z")}
    ${driver({ x: 72, y: 30.5, r: 5.6 }, c)}
    <path d="M10 52C10 42 14 38 22 37H96C106 38 110 44 110 52V58Q110 61 106 61H14Q10 61 10 58Z" fill="${c.B}" ${SW}/>
    <path d="M14 47Q60 43.5 106 47" fill="none" stroke="${c.L}" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M60 39V53M64 44.5h4" stroke="${OUT}" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
    ${wheel(32)}${wheel(86)}${tail(8, 42)}${eye(103, 46.5, 5.2, c)}${smile("M98 56Q104 60 109 55")}`,

  camper: c => `
    ${arch(30)}${arch(88)}
    <path d="M28 20V16M64 20V16" stroke="${OUT}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M21 15.5Q21 11.5 28 11.5H66Q74 12 74 15.5T66 19.5H28Q21 19.5 21 15.5Z" fill="${LAMP}" ${SWS}/><path d="M26 15.5H69" stroke="${c.B}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M8 58V30Q8 20 18 20H82Q87 20 90 25L108 46Q111 50 111 54V58Q111 61 107 61H12Q8 61 8 58Z" fill="${c.B}" ${SW}/>
    <path d="M9.5 33V30Q9.5 21.5 18 21.5H81Q85.5 21.5 88 25.5L93 33Z" fill="${c.L}"/>
    <path d="M8 33H93" stroke="${OUT}" stroke-width="2" opacity=".55"/>
    <rect x="16" y="26" width="19" height="13" rx="4.5" fill="${GLASS}" ${SWS}/><rect x="39" y="26" width="19" height="13" rx="4.5" fill="${GLASS}" ${SWS}/>
    <rect x="62" y="26" width="19" height="13" rx="4.5" fill="${GLASS}" ${SWS}/>
    ${driver({ x: 72, y: 33.5, r: 6.1 }, c)}
    <path d="M84 24Q86 24 88 27L97 42H84Z" fill="${GLASS}" ${SWS}/>
    <path d="M60 22V56M58 46h-2.5" stroke="${OUT}" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>
    <path d="M10 49Q60 45 108 52" fill="none" stroke="${c.L}" stroke-width="3.2" stroke-linecap="round"/>
    ${wheel(30)}${wheel(88)}${tail(7, 41, 4.5, 8)}${eye(104, 51, 5.2, c)}${smile("M97.5 57.5Q104 61 110 56.5")}`,

  pickup: c => `
    ${arch(28, 13.4, 56)}${arch(88, 13.4, 56)}
    <rect x="17" y="27" width="18" height="12" rx="2.5" fill="${c.L}" ${SWS}/><path d="M26 27V39M17 33H35" stroke="${OUT}" stroke-width="1.4" opacity=".5"/>
    <circle cx="43" cy="33.5" r="5.5" fill="${c.D}" ${SWS}/>
    <path d="M56 58V30Q57 22 66 22H80Q86 22 90 28L94 36L106 37Q112 38 112 44V58Q112 61 108 61H56Z" fill="${c.B}" ${SW}/>
    ${glass("M62 26.5Q63 25.5 66 25.5H79Q83 25.5 86 30L88 36H62Z")}
    ${driver({ x: 72, y: 31.5, r: 5.2 }, c)}
    <path d="M8 58V40Q8 37 11 37H56V61H12Q8 61 8 58Z" fill="${c.B}" ${SW}/>
    <path d="M9 41.5H55" stroke="${c.L}" stroke-width="3" stroke-linecap="round"/><path d="M9 47H56" stroke="${OUT}" stroke-width="1.6" opacity=".35"/>
    <path d="M60 39V54M64 45h4" stroke="${OUT}" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>
    ${wheel(28, 56, 10)}${wheel(88, 56, 10)}${tail(7, 41, 4.5, 8)}${eye(106, 46.5, 4.8, c)}${smile("M98 57Q104 61 110 56")}`,

  convertible: c => `
    ${arch(28)}${arch(90)}
    <path d="M20 40Q19 30 28 30H40Q47 30 47 40Z" fill="${c.D}" ${SW}/>
    <path d="M51 41Q51 33 59 33Q67 33 67 41Z" fill="${c.L}" ${SWS}/>
    ${driver({ x: 59, y: 26.5, r: 7.3 }, c)}
    <path d="M70 40L78 26.5H82.5L77.5 40Z" fill="${GLASS}" ${SWS}/>
    <path d="M8 58V47Q8 41 15 40L52 39H64Q78 39 90 43L106 45Q112 47 112 53V58Q112 61 108 61H12Q8 61 8 58Z" fill="${c.B}" ${SW}/>
    <path d="M12 50Q60 47 108 51" fill="none" stroke="${c.L}" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M62 44V54" stroke="${OUT}" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>
    ${wheel(28)}${wheel(90)}${tail(7, 46, 4.5, 6.5)}${eye(105.5, 50, 4.7, c)}${smile("M99.5 57.5Q105 61 110.5 56.5")}`,

  rv: c => `
    ${arch(28, 13)}${arch(90, 13)}
    <rect x="30" y="8" width="23" height="7" rx="2.5" fill="#e8ebec" ${SWS}/><path d="M34 8V6M49 8V6" stroke="${OUT}" stroke-width="2" stroke-linecap="round"/>
    <path d="M6 58V22Q6 14 14 14H84Q90 14 91 20L92 26L104 27Q112 29 112 38V58Q112 61 108 61H10Q6 61 6 58Z" fill="${c.B}" ${SW}/>
    <path d="M7.5 46H110.5V52H7.5Z" fill="${c.L}"/>
    <rect x="13" y="22" width="18" height="14" rx="4" fill="${GLASS}" ${SWS}/><rect x="35" y="22" width="18" height="14" rx="4" fill="${GLASS}" ${SWS}/>
    <rect x="58" y="22" width="14" height="30" rx="3.5" fill="${c.D}" ${SWS}/><rect x="61" y="25" width="8" height="9" rx="2.5" fill="${GLASS}" ${SWS}/>
    <path d="M95 31H103Q108 32 109 38V44H95Z" fill="${GLASS}" ${SWS}/>
    ${driver({ x: 102.5, y: 38.2, r: 5.4 }, c)}
    <path d="M80 18V42" stroke="${OUT}" stroke-width="1.6" opacity=".4"/>
    ${wheel(28, 57, 10)}${wheel(90, 57, 10)}${tail(5, 38, 4.5, 8)}${eye(105.6, 53, 4.4, c)}${smile("M98 58.6Q102 61 108 58.5")}`,

  moto: c => `
    <path d="M52 55L28 58" stroke="${METAL}" stroke-width="5" stroke-linecap="round"/><path d="M52 55L28 58" stroke="${OUT}" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>
    ${wheel(26, 55, 11)}${wheel(94, 55, 11)}
    <path d="M26 55L48 42M94 55L84 31M48 42L66 52L90 49" fill="none" stroke="${OUT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M47 43L66 52" stroke="${c.D}" stroke-width="2" stroke-linecap="round"/>
    <rect x="51" y="44" width="21" height="13" rx="4" fill="${METAL}" ${SWS}/>
    <path d="M30 38Q40 34 52 36.5L52 41H28Z" fill="${c.D}" ${SW}/>
    <path d="M50 35Q62 28 77 33L73 44H50Z" fill="${c.B}" ${SW}/>
    <path d="M54 37Q62 33 72 36" fill="none" stroke="${c.L}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M86 29Q83 21 89.5 19.5L91.5 22Q89 26 91.5 30Z" fill="${GLASS}" ${SWS}/>
    <path d="M50 37L61 26.5L84 30.5" fill="none" stroke="${OUT}" stroke-width="10.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M50 37L61 26.5L84 30.5" fill="none" stroke="${c.L}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M52 38L58 46L55.5 53" fill="none" stroke="${OUT}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M52 38L58 46L55.5 53" fill="none" stroke="${c.D}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
    ${driver({ x: 64, y: 17.5, r: 7.6 }, c)}
    <path d="M82 28.5H89L92 30" fill="none" stroke="${OUT}" stroke-width="3" stroke-linecap="round"/>
    ${eye(89.5, 38, 4.8, c)}${tail(11, 33, 5, 6)}`,

  ev: c => `
    ${arch(30)}${arch(88)}
    <path d="M18 39C25 26 34 21 48 21H66C78 21 88 28 98 39Z" fill="${c.B}" ${SW}/>
    ${glass("M27 37C31 28 38 24 48 24H55V37Z")}${glass("M59 24H66C75 24 82 29 89 37H59Z")}
    ${driver({ x: 70, y: 31, r: 5.5 }, c)}
    <path d="M8 52C8 44 12 40 20 38L38 36L100 38Q110 40 112 48V58Q112 61 108 61H12Q8 61 8 58Z" fill="${c.B}" ${SW}/>
    <path d="M12 46Q60 42 108 47" fill="none" stroke="${c.L}" stroke-width="3.2" stroke-linecap="round"/>
    <circle cx="58" cy="50" r="6.6" fill="#fff" ${SWS}/><path d="M59.5 44.4L54.6 51.2H58L56.6 56.2L62 49H58.4Z" fill="#f5c332" stroke="${OUT}" stroke-width="1.1" stroke-linejoin="round"/>
    ${wheel(30)}${wheel(88)}${tail(7, 44, 4.5, 8)}
    <path d="M98 44Q106 41.5 111 46.5Q105 49.5 98 47Z" fill="${LAMP}" ${SWS}/><circle cx="106" cy="45.7" r="1.7" fill="${OUT}"/>
    <path class="ride-lid" opacity="0" d="M97 44.4Q106 40 111.6 46.6L98 46.6Z" fill="${c.D}" ${SWS}/>
    ${smile("M99 56.5Q105 60 110 55.5")}`,

  bus: c => `
    ${arch(30)}${arch(90)}
    <rect x="40" y="8" width="23" height="9.5" rx="2.5" fill="${c.L}" ${SWS}/><path d="M47 8V5.5H56V8" fill="none" stroke="${OUT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="18" y="11" width="15" height="6.5" rx="2.5" fill="${c.D}" ${SWS}/>
    <path d="M8 58V26Q8 16 18 16H90Q98 16 102 24L110 42Q112 46 112 50V58Q112 61 108 61H12Q8 61 8 58Z" fill="${c.B}" ${SW}/>
    <path d="M8 44H109L111.4 49.5L112 51H8Z" fill="${c.L}"/>
    <rect x="14" y="24" width="15" height="14" rx="4" fill="${GLASS}" ${SWS}/><rect x="33" y="24" width="15" height="14" rx="4" fill="${GLASS}" ${SWS}/><rect x="52" y="24" width="15" height="14" rx="4" fill="${GLASS}" ${SWS}/>
    <rect x="70" y="24" width="17" height="14" rx="4" fill="${GLASS}" ${SWS}/>
    ${driver({ x: 78.5, y: 31.6, r: 6 }, c)}
    <path d="M91 23Q95 23 97 27L105 42H91Z" fill="${GLASS}" ${SWS}/>
    <path d="M68.5 22V56" stroke="${OUT}" stroke-width="1.6" opacity=".4"/>
    ${wheel(30)}${wheel(90)}${tail(7, 40, 4.5, 8)}${eye(106, 51, 5.1, c)}${smile("M99 57.5Q104.5 61 110 56.5")}`,
};

/**
 * The picture of a ride as SVG markup. opts: kind, color, badge (default: the saved ride), size (px width; height is
 * two thirds of it), facing "right" (default) or "left", rotate (degrees), zz (include the hidden sleepy "z z"),
 * label (accessible name; without it the picture is decoration).
 */
function markup(o, saved) {
  const r = cleanRide({ ...saved, ...o });
  const col = colorOf(r.color).hex;
  const c = { B: col, D: mix(col, "#1b1410", 0.3), L: mix(col, "#ffffff", 0.42), badge: r.badge, flip: o.facing === "left" };
  const size = num(o.size) && o.size > 0 ? o.size : 120;
  const art = (ART[r.kind] || ART.compact)(c);
  const body = `<g class="ride-art">${o.facing === "left" ? `<g transform="translate(120 0) scale(-1 1)">${art}</g>` : art}</g>`;
  const rot = num(o.rotate) && o.rotate ? `<g transform="rotate(${r1(o.rotate)} 60 60)">` + body + "</g>" : body;
  const ground = `<ellipse class="ride-shadow" cx="60" cy="68" rx="46" ry="3.2" fill="#000" opacity=".22"/>`;
  const zx = o.facing === "left" ? [24, 12] : [82, 94];
  const zz = o.zz === false ? "" :
    `<g class="ride-zz" opacity="0" fill="#fff" stroke="${OUT}" stroke-width="3.2" paint-order="stroke" stroke-linejoin="round" font-family="Overpass,system-ui,sans-serif" font-weight="900"><text class="z1" x="${zx[0]}" y="14" font-size="22">z</text><text class="z2" x="${zx[1]}" y="2" font-size="16">z</text></g>`;
  const name = o.label ? ` role="img" aria-label="${esc(o.label)}"` : ` aria-hidden="true" focusable="false"`;
  return `<svg xmlns="${NS}" class="ride-svg" viewBox="0 0 120 80" width="${r1(size)}" height="${r1(size * 2 / 3)}"${name}>${ground}${rot}${zz}</svg>`;
}

/* ---------- module state ---------- */
let api = null;
let ride = { ...DEFAULT };
let slotEl = null, rowEl = null, sheetEl = null, inviteEl = null, inviteTimer = 0;
let motion = "sleepy", lastMoveAt = 0, sleepAfter = 60000, motionTimer = 0;
let sheetBuilt = false;
const picker = {};

const S = () => (api && api.S) || {};
function readRide() {
  try { return cleanRide(api.store.get(KEY, null)); } catch { return { ...DEFAULT }; }
}
function saveRide() { try { api.store.set(KEY, ride); } catch {} }
const hasSaved = () => { try { return !!api.store.get(KEY, null); } catch { return false; } };

function svgEl(opts) {
  const d = document.createElement("div");
  d.innerHTML = markup(opts || {}, ride);
  return d.firstElementChild;
}
function publicSvg(opts) {
  opts = opts || {};
  return opts.markup ? markup(opts, ride) : svgEl(opts);
}

function setRide(patch, quiet) {
  const next = cleanRide({ ...ride, ...patch });
  const changed = JSON.stringify(next) !== JSON.stringify(ride);
  ride = next;
  if (!changed) return false;
  saveRide();
  refreshAll();
  if (!quiet) { try { api.bus.emit("ride", { ride: { ...ride } }); } catch (e) { warn(e); } }
  return true;
}

/* ---------- motion: moving, idle, or asleep ---------- */
function isMoving() {
  const st = S(), mode = st.mode;
  if (mode !== "gps" && mode !== "demo") return false;
  return num(st.speed) ? st.speed >= MOVING_MPH : mode === "demo";
}
function computeMotion() {
  const st = S();
  clearTimeout(motionTimer);
  let next;
  if (isMoving()) { lastMoveAt = Date.now(); next = "moving"; }
  else if (!st.mode || st.mode === "off") next = "sleepy";               // parked: tracking is not running
  else {
    const left = sleepAfter - (Date.now() - lastMoveAt);                 // stopped, or following by hand
    if (left <= 0) next = "sleepy";
    else { next = "idle"; motionTimer = setTimeout(computeMotion, left + 20); }
  }
  if (next !== motion) {
    motion = next;
    applyMotionClass();
    try { api.bus.emit("ride:state", { state: motion }); } catch {}
  }
}
function applyMotionClass() {
  for (const e of [slotEl, rowEl]) {
    if (!e) continue;
    e.classList.toggle("ride-moving", motion === "moving");
    e.classList.toggle("ride-idle", motion === "idle");
    e.classList.toggle("ride-sleepy", motion === "sleepy");
  }
}

/* ---------- Drive sign slot, Settings row ---------- */
function renderSlot() {
  if (!slotEl) return;
  slotEl.textContent = "";
  const b = el("button", "ride-slot-btn");
  b.type = "button";
  b.setAttribute("aria-label", `Your ride: ${describe(ride)}${ride.name ? `, ${ride.name}` : ""}. Tap to change it`);
  if (ride.name) b.title = ride.name;
  b.append(svgEl({ size: 46 }));
  b.addEventListener("click", () => { dismissInvite(); open(b); });
  slotEl.append(b);
  slotEl.hidden = false;
  applyMotionClass();
}
function renderRow() {
  if (!rowEl) return;
  rowEl.textContent = "";
  rowEl.classList.add("ride-row");
  const lab = el("span", "ride-row-lab", "Your ride");
  const line = el("div", "ride-row-line");
  const art = el("span", "ride-row-art");
  art.append(svgEl({ size: 56 }));
  const txt = el("span", "ride-row-txt");
  txt.append(el("b", null, ride.name || describe(ride)));
  if (ride.name) txt.append(el("small", null, describe(ride)));
  const go = el("button", "secondary ride-row-go", "Change");
  go.type = "button";
  go.addEventListener("click", () => open(go));
  line.append(art, txt, go);
  rowEl.append(lab, line);
  applyMotionClass();
}
function refreshAll() {
  renderSlot(); renderRow();
  if (sheetBuilt) syncPicker();
}

/* ---------- the picker ---------- */
function btn(cls, text, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
function buildSheet() {
  if (sheetBuilt || !sheetEl) return;
  sheetEl.textContent = "";
  const head = el("div", "sheet-head");
  head.append(el("b", null, "Pick your ride"));
  const done0 = btn("link", "Done", close);
  head.append(done0);

  const stage = el("div", "ride-stage");
  picker.stage = stage;
  picker.big = el("div", "ride-big");
  picker.cap = el("p", "ride-cap");
  picker.cap.setAttribute("aria-live", "polite");
  stage.append(picker.big, el("div", "ride-road"), picker.cap);

  const grid = el("div", "ride-grid");
  grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Vehicle");
  picker.opts = [];
  for (const k of KINDS) {
    const b = btn("ride-opt", null, () => setRide({ kind: k.id }));
    b.dataset.kind = k.id;
    b.append(el("span", "ride-opt-art"), el("span", "ride-opt-name", k.name));
    grid.append(b);
    picker.opts.push(b);
  }

  const swatches = el("div", "ride-colors");
  swatches.setAttribute("role", "group"); swatches.setAttribute("aria-label", "Colour");
  picker.sw = [];
  for (const c of COLORS) {
    const b = btn("ride-sw", null, () => setRide({ color: c.id }));
    b.dataset.color = c.id;
    b.style.setProperty("--ride-c", c.hex);
    b.setAttribute("aria-label", c.name);
    b.title = c.name;
    swatches.append(b);
    picker.sw.push(b);
  }

  const badgeBox = el("div", "field ride-field");
  const bl = el("label", null, "Driver badge");
  bl.htmlFor = "rideBadge";
  const hint1 = el("small", "hint", "One emoji or up to 2 letters, shown as the driver.");
  const input = document.createElement("input");
  input.id = "rideBadge"; input.type = "text"; input.className = "ride-input"; input.autocomplete = "off"; input.autocapitalize = "characters";
  input.spellcheck = false; input.maxLength = 12; input.placeholder = "None";
  input.addEventListener("input", () => setRide({ badge: input.value }, false));
  input.addEventListener("change", () => { input.value = ride.badge; });
  picker.badge = input;
  const chips = el("div", "ride-emoji");
  chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "Badge ideas");
  picker.chips = [];
  for (const e of EMOJI_CHOICES) {
    const b = btn("ride-chip", e, () => setRide({ badge: ride.badge === e ? "" : e }));
    b.setAttribute("aria-label", `Badge ${e}`);
    b.dataset.badge = e;
    chips.append(b); picker.chips.push(b);
  }
  badgeBox.append(bl, input, chips, hint1);

  const nameBox = el("div", "field ride-field");
  const nl = el("label", null, "Nickname");
  nl.htmlFor = "rideName";
  const nin = document.createElement("input");
  nin.id = "rideName"; nin.type = "text"; nin.className = "ride-input"; nin.maxLength = NAME_MAX; nin.autocomplete = "off";
  nin.placeholder = "Optional, up to 20 characters";
  nin.addEventListener("input", () => setRide({ name: nin.value }));
  nin.addEventListener("change", () => { nin.value = ride.name; });
  picker.name = nin;
  nameBox.append(nl, nin);

  const done = btn("primary ride-done", "Done", close);
  sheetEl.append(head, stage, grid, swatches, badgeBox, nameBox, done);
  sheetBuilt = true;
  syncPicker();
  applyMotionClass();
}
function syncPicker() {
  if (!sheetBuilt) return;
  picker.big.textContent = "";
  picker.big.append(svgEl({ size: 168, label: describe(ride) }));
  picker.cap.textContent = ride.name ? `${ride.name}, ${describe(ride)}` : describe(ride);
  for (const b of picker.opts) {
    b.setAttribute("aria-pressed", String(b.dataset.kind === ride.kind));
    const art = b.querySelector(".ride-opt-art");
    const want = b.dataset.kind + "|" + ride.color + "|" + ride.badge;
    if (art.dataset.k !== want) { art.dataset.k = want; art.textContent = ""; art.append(svgEl({ kind: b.dataset.kind, size: 72, zz: false })); }
  }
  for (const b of picker.sw) b.setAttribute("aria-pressed", String(b.dataset.color === ride.color));
  for (const b of picker.chips) b.setAttribute("aria-pressed", String(b.dataset.badge === ride.badge));
  if (document.activeElement !== picker.badge) picker.badge.value = ride.badge;
  if (document.activeElement !== picker.name) picker.name.value = ride.name;
}
function open(opener) {
  try {
    dismissInvite();
    buildSheet();
    syncPicker();
    api.ui.openSheet(sheetEl);
    const first = sheetEl.querySelector(".ride-opt[aria-pressed='true']") || sheetEl.querySelector(".ride-opt");
    if (first && opener !== undefined) try { first.focus({ preventScroll: true }); } catch {}
  } catch (e) { warn(e); }
}
function close() { try { api.ui.closeSheet(); } catch {} }

/* ---------- the first-run invitation ---------- */
function sheetOpen() { return !!document.querySelector(".sheet:not([hidden])"); }
function dismissInvite() {
  clearTimeout(inviteTimer);
  if (inviteEl) { inviteEl.remove(); inviteEl = null; }
}
function maybeInvite() {
  try {
    if (inviteEl || !slotEl || slotEl.hidden) return;
    if (api.store.get(SEEN_KEY, false)) return;
    if (hasSaved()) { api.store.set(SEEN_KEY, true); return; }
    const st = S();
    if (num(st.speed) && st.speed >= 8) return;          // never while driving; it waits for a stop
    if (st.mode === "gps" || st.mode === "demo") { if (isMoving()) return; }
    if (sheetOpen()) return;
    const view = document.getElementById("view-drive");
    if (!view || view.hidden) return;
    const host = document.getElementById("rideInvite");
    if (!host) return;
    api.store.set(SEEN_KEY, true);                       // once only, even if it is ignored
    inviteEl = el("div", "ride-invite");
    inviteEl.setAttribute("role", "group");
    inviteEl.setAttribute("aria-label", "Pick your ride");
    inviteEl.append(el("p", null, "Pick your ride? It rides along on the map."));
    const acts = el("div", "ride-invite-acts");
    acts.append(btn("primary", "Pick", () => { dismissInvite(); open(); }), btn("secondary", "Not now", dismissInvite));
    inviteEl.append(acts);
    // In the page's flow just under the sign (#rideInvite), never floating over the alerts below it; the little arrow
    // points up at the ride on the sign.
    host.append(inviteEl);
    const b = slotEl.getBoundingClientRect(), h = inviteEl.getBoundingClientRect();
    inviteEl.style.setProperty("--ride-arrow", Math.round(Math.max(20, Math.min(h.width - 20, b.left - h.left + b.width / 2))) + "px");
    inviteTimer = setTimeout(dismissInvite, 16000);
  } catch (e) { warn(e); }
}

/* ---------- entry ---------- */
export function init(a) {
  api = a || {};
  try {
    ride = readRide();
    slotEl = document.getElementById("rideSlot");
    rowEl = document.getElementById("rideRow");
    sheetEl = document.getElementById("rideSheet");
    api.ride = {
      get: () => ({ ...ride }),
      svg: publicSvg,
      list: () => ({ kinds: KINDS.map(k => ({ ...k })), colors: COLORS.map(c => ({ ...c })) }),
      set: p => setRide(p),
      open: () => open(),
      state: () => motion,
      describe: r => describe(cleanRide(r || ride)),
      get sleepAfterMs() { return sleepAfter; },
      set sleepAfterMs(v) { if (num(v) && v >= 0) { sleepAfter = v; computeMotion(); } },
    };
    renderSlot(); renderRow();
    const on = (evt, fn) => { try { api.bus.on(evt, e => { try { fn(e); } catch (err) { warn(err); } }); } catch (e) { warn(e); } };
    on("pos", () => { computeMotion(); });
    on("mode", () => { computeMotion(); maybeInviteSoon(); });
    on("tab", t => { if (t === "drive") maybeInviteSoon(); else dismissInvite(); });
    computeMotion();
    setTimeout(maybeInvite, 1800);
  } catch (e) { warn(e); }
}
let soonTimer = 0;
function maybeInviteSoon() { clearTimeout(soonTimer); soonTimer = setTimeout(maybeInvite, 1200); }
