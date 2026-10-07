"use strict";
// Inkle Pattern Generator, web version. A port of inkle.py: keep constants, geometry and the .inkl
// format in sync with the desktop app.

const DEFAULT_PRESETS = [
  "#000000", "#404040", "#808080", "#C0C0C0", "#FFFFFF", "#F5F5DC",
  "#8B0000", "#DC143C", "#FF0000", "#FF7F50", "#FFA500", "#FFD700",
  "#FFFF00", "#9ACD32", "#32CD32", "#006400", "#008080", "#00FFFF",
  "#87CEEB", "#1E90FF", "#0000CD", "#000080", "#4B0082", "#8A2BE2",
  "#FF69B4", "#FF00FF", "#800080", "#A52A2A", "#8B4513", "#D2B48C",
  "#CD4D55", "#E2D047", "#009400",
];
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const PRESETS_KEY = "inklePatterns.presets";

const LABEL_W = 36;
const CELL = 24; // fixed height of the H/U grid cells; width is dynamic, see gridCellWidth()
const GRID_CELL_MIN = 2, GRID_CELL_MAX = 60;
const GRID_H = 2 * CELL;
const UNDO_LIMIT = 500;
const PAD = 10;
const EMPTY = "#FFFFFF";
const LINE = "#C8CCD2"; // grid cell outlines
const HEX_LINE = "#3A3A3A"; // hexagon outlines
const CANVAS_BG = "#F0F1F3";
const ACCENT = "#0067C0";

const $ = (id) => document.getElementById(id);
const pkey = (i, r) => i + "," + r; // pick-ups are stored as "thread,row" strings in a Set
const unkey = (k) => k.split(",").map(Number);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function parseWhole(s) {
  return /^\s*-?\d+\s*$/.test(s) ? parseInt(s, 10) : NaN;
}

// ---------- geometry (same as inkle.py) ----------

function hexDims(hw) {
  const a = hw * 0.7;
  return { a, spacing: 4.8 * hw - a };
}

/** Hexagon for thread `i`, row `r`. `px` is the origin across threads, `py` the origin along rows.
 *  Unrotated: pointy top/bottom, threads run horizontally. Rotated: pointy left/right, rows run horizontally. */
function hexPoly(px, hw, py, a, spacing, r, i, rotated) {
  const hh = spacing + a;
  if (rotated) {
    const cy = px + (i + 1) * hw, x = py + r * spacing;
    return [[x, cy], [x + a, cy - hw], [x + hh - a, cy - hw], [x + hh, cy], [x + hh - a, cy + hw], [x + a, cy + hw]];
  }
  const cx = px + (i + 1) * hw, y = py + r * spacing;
  return [[cx, y], [cx + hw, y + a], [cx + hw, y + hh - a], [cx, y + hh], [cx - hw, y + hh - a], [cx - hw, y + a]];
}

function fillPoly(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

/** Draw rows rFrom..rTo of a honeycomb of `rows` rows, with pick-up bars for keys in `pickups`. */
function drawHoneycomb(ctx, threads, pickups, x0, py, hw, a, spacing, rows, rotated, rFrom = 0, rTo = rows - 1) {
  const n = threads.length;
  ctx.strokeStyle = HEX_LINE;
  ctx.lineWidth = 1;
  for (let r = Math.max(0, rFrom); r <= Math.min(rTo, rows - 1); r++) {
    for (let i = r % 2; i < n; i += 2) fillPoly(ctx, hexPoly(x0, hw, py, a, spacing, r, i, rotated), threads[i] || EMPTY);
  }
  // pick-ups: the hexagon is stretched up to the next hexagon in its column, passing over the row between
  for (const k of pickups) {
    const [i, r] = unkey(k);
    if (r - 2 < 0 || r >= rows || i >= n || r < rFrom || r - 2 > rTo) continue;
    const up = hexPoly(x0, hw, py, a, spacing, r - 2, i, rotated);
    const low = hexPoly(x0, hw, py, a, spacing, r, i, rotated);
    fillPoly(ctx, [up[0], up[1], low[2], low[3], low[4], up[5]], threads[i] || EMPTY);
  }
}

// ---------- ScrollView: a viewport-sized canvas under a transparent scroller ----------
// Browsers cap canvas size (a long repeat preview can be far taller), so only the visible part is drawn.

class ScrollView {
  constructor(host, draw, { paint = false } = {}) {
    host.classList.add("scrollview");
    this.canvas = document.createElement("canvas");
    this.scroller = document.createElement("div");
    this.scroller.className = "sv-scroller" + (paint ? " paint" : "");
    this.spacer = document.createElement("div");
    this.scroller.appendChild(this.spacer);
    host.append(this.canvas, this.scroller);
    this.draw = draw;
    this.scroller.addEventListener("scroll", () => this.render());
  }
  get viewW() { return this.scroller.clientWidth; }
  get viewH() { return this.scroller.clientHeight; }
  setContentSize(w, h) {
    this.spacer.style.width = Math.ceil(w) + "px";
    this.spacer.style.height = Math.ceil(h) + "px";
  }
  render() {
    const w = this.viewW, h = this.viewH;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + "px";
      c.style.height = h + "px";
    }
    const ctx = c.getContext("2d");
    const sx = this.scroller.scrollLeft, sy = this.scroller.scrollTop;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(-sx, -sy);
    this.draw(ctx, sx, sy, w, h);
  }
  /** Event position in content coordinates (scroll offset included). */
  point(e) {
    const rect = this.scroller.getBoundingClientRect();
    return { x: e.clientX - rect.left + this.scroller.scrollLeft, y: e.clientY - rect.top + this.scroller.scrollTop };
  }
}

/** Left-click/drag paints, right-click/drag erases (also left with the Eraser box ticked). */
function bindPaint(el, pointOf, handler) {
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const rect = el.getBoundingClientRect();
    if (e.clientX - rect.left >= el.clientWidth || e.clientY - rect.top >= el.clientHeight) return; // scrollbar
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    drag = { erase: e.button === 2 || $("eraser").checked };
    handler(pointOf(e), drag.erase, true, e.shiftKey);
  });
  el.addEventListener("pointermove", (e) => {
    if (drag) handler(pointOf(e), drag.erase, false, e.shiftKey);
  });
  const end = () => { drag = null; };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

/** Ctrl+wheel (or trackpad pinch) zooms; accumulates small trackpad deltas into whole steps. */
function bindWheelZoom(el, zoomBy) {
  let acc = 0;
  el.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    acc += e.deltaY;
    if (Math.abs(acc) >= 40) {
      zoomBy(acc < 0 ? 1 : -1);
      acc = 0;
    }
  }, { passive: false });
}

// ---------- state ----------

const S = {
  threads: [], // color hex or null per thread; even index = heddled, odd = unheddled
  pickups: new Set(), // "thread,row": hexagon at that row is joined to the one two rows above
  range: [0, 0], // (first row, last row) of the preview used as the repeat unit
  visibleRows: 1,
  rotated: false,
  color: "#DC143C",
  presets: loadPresets(),
  undo: [], redo: [], // (threads, pickups) snapshots; one entry per click/drag stroke or Generate
  strokeSaved: false,
  pickTarget: true,
  rangeAnchor: null,
  fileName: null, fileHandle: null,
  dirty: false,
  geom: null, // preview geometry from the last redraw, for hit-testing
};

const mode = () => document.querySelector('input[name="mode"]:checked').value;
const zoomLevel = () => Number($("zoom").value);

// ---------- presets ----------

function loadPresets() {
  try {
    const d = JSON.parse(localStorage.getItem(PRESETS_KEY));
    if (Array.isArray(d) && d.length && d.every((c) => typeof c === "string" && HEX_RE.test(c))) {
      return d.map((c) => c.toUpperCase());
    }
  } catch (_) { /* storage unavailable or malformed */ }
  return DEFAULT_PRESETS.slice();
}

function presetsChanged() {
  buildPalette();
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(S.presets)); } catch (_) { /* not persisted */ }
}

function buildPalette() {
  const pal = $("palette");
  pal.textContent = "";
  S.presets.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "swatch" + (c.toUpperCase() === S.color.toUpperCase() ? " selected" : "");
    b.style.background = c;
    b.title = c;
    b.setAttribute("aria-label", "Preset color " + c);
    b.addEventListener("click", () => setColor(c));
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (S.presets[i] !== S.color) { S.presets[i] = S.color; presetsChanged(); }
    });
    pal.appendChild(b);
  });
}

// ---------- color ----------

function setColor(hex) {
  S.color = hex.toUpperCase();
  const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  ["R", "G", "B"].forEach((n, k) => { $("s" + n).value = rgb[k]; });
  refreshSwatch();
}

function onSlider() {
  S.color = "#" + ["R", "G", "B"].map((n) => Number($("s" + n).value).toString(16).padStart(2, "0")).join("").toUpperCase();
  refreshSwatch();
}

function refreshSwatch() {
  $("curSwatch").style.background = S.color;
  $("curHex").textContent = S.color;
  for (const n of ["R", "G", "B"]) $("v" + n).textContent = $("s" + n).value;
  buildPalette(); // moves the selection ring
}

// ---------- undo / redo ----------

const snapshot = () => [S.threads.slice(), new Set(S.pickups)];

function pushUndo() {
  S.undo.push(snapshot());
  if (S.undo.length > UNDO_LIMIT) S.undo.splice(0, S.undo.length - UNDO_LIMIT);
  S.redo.length = 0;
  updateUndoButtons();
}

/** Call just before modifying the pattern from a click/drag: pushes one undo entry per stroke. */
function checkpoint() {
  if (!S.strokeSaved) {
    S.strokeSaved = true;
    pushUndo();
  }
  S.dirty = true;
}

function undo() {
  if (S.undo.length) { S.redo.push(snapshot()); restore(S.undo.pop()); }
}

function redo() {
  if (S.redo.length) { S.undo.push(snapshot()); restore(S.redo.pop()); }
}

function restore([threads, pickups]) {
  S.threads = threads.slice();
  S.pickups = new Set(pickups);
  $("count").value = S.threads.length;
  S.dirty = true;
  updateUndoButtons();
  refresh();
}

function clearHistory() {
  S.undo.length = 0;
  S.redo.length = 0;
  updateUndoButtons();
}

function updateUndoButtons() {
  $("undoBtn").disabled = !S.undo.length;
  $("redoBtn").disabled = !S.redo.length;
}

// ---------- pattern ----------

function generate() {
  const n = parseWhole($("count").value);
  if (!(n >= 1 && n <= 200)) {
    alert("Enter a whole number of threads between 1 and 200.");
    return;
  }
  const had = S.threads.length > 0;
  if (had) pushUndo(); // lets an accidental Generate be undone
  S.threads = new Array(n).fill(null);
  S.pickups = new Set();
  S.dirty = had;
  refresh();
  selectFullRange();
}

function selectFullRange() {
  setRange(0, Math.max(S.visibleRows - 1, 0));
}

function applyRangeEntries() {
  const lo = parseWhole($("rangeStart").value), hi = parseWhole($("rangeEnd").value);
  if (Number.isNaN(lo) || Number.isNaN(hi)) {
    alert("Row numbers must be whole numbers.");
    return;
  }
  setRange(lo, hi);
}

function setRange(lo, hi) {
  if (lo > hi) [lo, hi] = [hi, lo];
  S.range = [lo, hi];
  clampRange();
  redraw();
}

/** Clamp the repeat range to the rows currently visible and mirror it into the Rows fields. */
function clampRange() {
  const maxRow = Math.max(S.visibleRows - 1, 0);
  const lo = clamp(S.range[0], 0, maxRow);
  const hi = Math.max(lo, Math.min(S.range[1], maxRow));
  S.range = [lo, hi];
  $("rangeStart").value = lo;
  $("rangeEnd").value = hi;
}

function zoomBy(d) {
  $("zoom").value = clamp(zoomLevel() + d, 2, 20);
  redraw();
}

// ---------- H/U grid ----------

const gridCanvas = $("gridCanvas");

function gridCellWidth() {
  const n = S.threads.length;
  if (!n) return CELL;
  const avail = Math.max(gridCanvas.clientWidth - PAD - LABEL_W - PAD, 1);
  return clamp(avail / n, GRID_CELL_MIN, GRID_CELL_MAX);
}

function drawGrid() {
  const w = gridCanvas.clientWidth, h = gridCanvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  gridCanvas.width = Math.round(w * dpr);
  gridCanvas.height = Math.round(h * dpr);
  const ctx = gridCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, w, h);
  const n = S.threads.length;
  if (!n) return;
  const gcell = gridCellWidth(), x0 = PAD + LABEL_W;
  ctx.font = "bold 15px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ["H", "U"].forEach((lab, r) => {
    ctx.fillStyle = "#1B1B1F";
    ctx.fillText(lab, PAD + LABEL_W / 2, PAD + r * CELL + CELL / 2);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 === r ? (S.threads[i] || EMPTY) : EMPTY;
      ctx.fillRect(x0 + i * gcell, PAD + r * CELL, gcell, CELL);
      ctx.strokeRect(x0 + i * gcell, PAD + r * CELL, gcell, CELL);
    }
  });
}

function gridThreadAt(x, y) {
  const n = S.threads.length;
  if (!n || !(y >= PAD && y < PAD + GRID_H)) return null;
  const x0 = PAD + LABEL_W;
  const row = Math.floor((y - PAD) / CELL);
  const i = Math.floor((x - x0) / gridCellWidth());
  return x >= x0 && i >= 0 && i < n && i % 2 === row ? i : null;
}

// ---------- preview ----------

const preview = new ScrollView($("previewPane"), drawPreview, { paint: true });

function redraw() {
  const sc = preview.scroller;
  // the thread axis scrolls; the row axis just fits as many rows as there's room for
  sc.style.overflowX = S.rotated ? "hidden" : "scroll";
  sc.style.overflowY = S.rotated ? "scroll" : "hidden";
  const w = preview.viewW, h = preview.viewH, n = S.threads.length;
  if (!n) {
    S.geom = null;
    preview.setContentSize(w, h);
    preview.render();
    return;
  }
  const acrossOrigin = S.rotated ? PAD : PAD + LABEL_W, alongOrigin = PAD;
  const availAlong = Math.max((S.rotated ? w : h) - alongOrigin - PAD, 1);
  const hw = zoomLevel();
  const { a, spacing } = hexDims(hw);
  const rows = Math.max(2, Math.floor((availAlong - a) / spacing));
  S.visibleRows = rows;
  clampRange();
  S.geom = { hw, a, spacing, rows, acrossOrigin, alongOrigin };
  const acrossExtent = acrossOrigin + (n + 1) * hw + PAD;
  if (S.rotated) preview.setContentSize(w, Math.max(acrossExtent, h));
  else preview.setContentSize(Math.max(acrossExtent, w), h);
  preview.render();
}

function drawPreview(ctx, sx, sy, vw, vh) {
  if (!S.geom) {
    ctx.fillStyle = "#777777";
    ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Enter the number of warp threads and click Generate", sx + vw / 2, sy + vh / 2);
    return;
  }
  const { hw, a, spacing, rows, acrossOrigin, alongOrigin } = S.geom;
  const n = S.threads.length;
  drawHoneycomb(ctx, S.threads, S.pickups, acrossOrigin, alongOrigin, hw, a, spacing, rows, S.rotated);
  // dashed box marking the rows selected as the repeat unit
  const [lo, hi] = S.range;
  const alongLo = alongOrigin + lo * spacing, alongHi = alongOrigin + hi * spacing + spacing + a;
  const acrossLo = acrossOrigin - hw, acrossHi = acrossOrigin + (n + 1) * hw + hw;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  if (S.rotated) ctx.strokeRect(alongLo, acrossLo, alongHi - alongLo, acrossHi - acrossLo);
  else ctx.strokeRect(acrossLo, alongLo, acrossHi - acrossLo, alongHi - alongLo);
  ctx.restore();
}

/** [thread, row] under a point in the preview (content coordinates), or null. */
function cellAt(x, y) {
  const g = S.geom;
  if (!g) return null;
  const { hw, a, spacing, rows, acrossOrigin, alongOrigin } = g;
  const n = S.threads.length;
  const [along, across] = S.rotated ? [x, y] : [y, x];
  if (along < alongOrigin) return null;
  // pick-up bars sit on top of neighboring hexagons, so test them first
  for (const k of S.pickups) {
    const [i, r] = unkey(k);
    if (r - 2 < 0 || r >= rows || i >= n || Math.abs(across - (acrossOrigin + (i + 1) * hw)) > hw) continue;
    const near = alongOrigin + (r - 1) * spacing; // lower shoulder of the upper hexagon
    const far = alongOrigin + r * spacing + a; // upper shoulder of the lower hexagon
    if (along >= near && along <= far) return [i, r];
  }
  const r0 = Math.floor((along - alongOrigin) / spacing);
  for (const r of [r0, r0 - 1]) {
    if (r < 0 || r >= rows) continue;
    for (let i = r % 2; i < n; i += 2) {
      if (Math.abs(across - (acrossOrigin + (i + 1) * hw)) > hw) continue;
      const poly = hexPoly(acrossOrigin, hw, alongOrigin, a, spacing, r, i, S.rotated);
      let pos = 0, neg = 0;
      for (let k = 0; k < 6; k++) {
        const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % 6];
        if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0) pos++; else neg++;
      }
      if (pos === 6 || neg === 6) return [i, r];
    }
  }
  return null;
}

function onPreview(pt, erase, press, shift) {
  if (!S.threads.length) return;
  if (press) S.strokeSaved = false;
  const m = mode();
  if (m === "range") return onRange(pt, erase, press);
  if (m === "pickup" || (shift && !erase)) return onPickup(pt, erase, press); // Shift+click picks up in either tool
  const cell = cellAt(pt.x, pt.y);
  if (!cell) return;
  const i = cell[0], nv = erase ? null : S.color;
  if (S.threads[i] !== nv) {
    checkpoint();
    S.threads[i] = nv;
    refresh();
  }
}

function onGrid(pt, erase, press, shift) {
  if (!S.threads.length) return;
  if (press) S.strokeSaved = false;
  // the H/U grid only colors threads; pick-up and row-select tools have no meaning here
  if (mode() !== "color" || (shift && !erase)) return;
  const i = gridThreadAt(pt.x, pt.y);
  if (i === null) return;
  const nv = erase ? null : S.color;
  if (S.threads[i] !== nv) {
    checkpoint();
    S.threads[i] = nv;
    refresh();
  }
}

function onRange(pt, erase, press) {
  const cell = cellAt(pt.x, pt.y);
  if (!cell) return;
  if (erase) { selectFullRange(); return; } // right-click/drag resets to the full preview
  const row = cell[1];
  if (press || S.rangeAnchor === null) S.rangeAnchor = row;
  setRange(S.rangeAnchor, row);
}

function onPickup(pt, erase, press) {
  const cell = cellAt(pt.x, pt.y);
  if (!cell || cell[1] < 2) return; // rows 0-1 have no hexagon two rows above to reach
  const k = pkey(cell[0], cell[1]);
  if (press) S.pickTarget = !S.pickups.has(k); // a drag applies the state chosen by the first cell pressed
  const want = erase ? false : S.pickTarget;
  if (S.pickups.has(k) !== want) {
    checkpoint();
    if (want) S.pickups.add(k); else S.pickups.delete(k);
    redraw();
  }
}

function refresh() {
  drawGrid();
  redraw();
}

// ---------- repeat preview ----------

const repeatDlg = $("repeatDlg");
const repeatView = new ScrollView($("repeatPane"), drawRepeat);
let R = null; // snapshot taken when the repeat preview is opened

function openRepeat() {
  if (!S.threads.length) {
    alert("Nothing to repeat. Generate a pattern first.");
    return;
  }
  const count = parseWhole($("repeats").value);
  if (!(count >= 1 && count <= 200)) {
    alert("Enter a whole number of repeats between 1 and 200.");
    return;
  }
  const [lo, hi] = S.range;
  const unitPickups = [...S.pickups].map(unkey).filter(([, r]) => r >= lo && r <= hi).map(([i, r]) => [i, r - lo]);
  R = { threads: S.threads.slice(), unitRows: hi - lo + 1, unitPickups, rotated: S.rotated, pickups: new Set(), total: 0 };
  $("rCount").value = count;
  $("rZoom").value = zoomLevel();
  $("rRotate").checked = S.rotated;
  if (!repeatDlg.open) repeatDlg.showModal();
  repeatView.scroller.scrollTo(0, 0);
  repeatRedraw();
}

function repeatRedraw() {
  if (!R || !repeatDlg.open) return;
  const count = parseWhole($("rCount").value);
  if (!(count >= 1 && count <= 200)) {
    alert("Enter a whole number of repeats between 1 and 200.");
    return;
  }
  R.total = R.unitRows * count;
  R.pickups = new Set();
  for (let rep = 0; rep < count; rep++) {
    for (const [i, r] of R.unitPickups) R.pickups.add(pkey(i, r + rep * R.unitRows));
  }
  const sc = repeatView.scroller;
  sc.style.overflow = "scroll"; // always both scrollbars: the content can be arbitrarily tall or wide
  const hw = Number($("rZoom").value);
  const { a, spacing } = hexDims(hw);
  const acrossExtent = PAD + (R.threads.length + 1) * hw + PAD;
  const alongExtent = PAD + R.total * spacing + a + PAD;
  const w = repeatView.viewW, h = repeatView.viewH;
  if (R.rotated) repeatView.setContentSize(Math.max(alongExtent, w), Math.max(acrossExtent, h));
  else repeatView.setContentSize(Math.max(acrossExtent, w), Math.max(alongExtent, h));
  repeatView.render();
}

function drawRepeat(ctx, sx, sy, vw, vh) {
  if (!R) return;
  const hw = Number($("rZoom").value);
  const { a, spacing } = hexDims(hw);
  // draw only the rows in view
  const [start, size] = R.rotated ? [sx, vw] : [sy, vh];
  const rFrom = Math.max(0, Math.floor((start - PAD - spacing - a) / spacing));
  const rTo = Math.min(R.total - 1, Math.ceil((start + size - PAD) / spacing));
  drawHoneycomb(ctx, R.threads, R.pickups, PAD, PAD, hw, a, spacing, R.total, R.rotated, rFrom, rTo);
}

function repeatZoomBy(d) {
  $("rZoom").value = clamp(Number($("rZoom").value) + d, 2, 20);
  repeatRedraw();
}

// ---------- files ----------

const FILE_TYPES = [{ description: "Inkle pattern", accept: { "application/json": [".inkl"] } }];

function patternJSON() {
  const pickups = [...S.pickups].map(unkey).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return JSON.stringify({ version: 1, threads: S.threads, pickups, range: S.range }, null, 1);
}

async function saveFile(saveAs = false) {
  if (!S.threads.length) {
    alert("Nothing to save. Generate a pattern first.");
    return;
  }
  const text = patternJSON();
  try {
    if (window.showSaveFilePicker) {
      // Chrome/Edge: real Save / Save As to a file on disk
      let handle = saveAs ? null : S.fileHandle;
      if (!handle) handle = await window.showSaveFilePicker({ suggestedName: S.fileName || "pattern.inkl", types: FILE_TYPES });
      const wr = await handle.createWritable();
      await wr.write(text);
      await wr.close();
      S.fileHandle = handle;
      S.fileName = handle.name;
    } else {
      // other browsers: download the file
      let name = S.fileName;
      if (saveAs || !name) {
        name = prompt("Save pattern as:", S.fileName || "pattern.inkl");
        if (!name) return;
        if (!name.toLowerCase().endsWith(".inkl")) name += ".inkl";
      }
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      S.fileName = name;
    }
  } catch (e) {
    if (e.name !== "AbortError") alert("Save failed: " + e.message);
    return;
  }
  S.dirty = false;
  updateTitle();
}

async function openFile() {
  if (window.showOpenFilePicker) {
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
    } catch (e) {
      if (e.name !== "AbortError") alert("Open failed: " + e.message);
      return;
    }
    const file = await handle.getFile();
    loadPattern(await file.text(), file.name, handle);
  } else {
    $("fileInput").click();
  }
}

function loadPattern(text, name, handle = null) {
  let threads, pickups, rng;
  try {
    const data = JSON.parse(text);
    threads = data.threads;
    if (!(Array.isArray(threads) && threads.length >= 1 && threads.length <= 200 &&
          threads.every((t) => t === null || (typeof t === "string" && HEX_RE.test(t))))) {
      throw new Error("invalid thread list");
    }
    const toInt = (v) => {
      const x = Number(v);
      if (typeof v === "boolean" || v === null || !Number.isFinite(x)) throw new Error("invalid number");
      return Math.trunc(x);
    };
    pickups = (data.pickups || []).map((p) => {
      if (!Array.isArray(p) || p.length !== 2) throw new Error("invalid pick-up");
      return [toInt(p[0]), toInt(p[1])];
    });
    rng = Array.isArray(data.range) && data.range.length === 2 ? [toInt(data.range[0]), toInt(data.range[1])] : null;
  } catch (e) {
    alert(`Could not read ${name}: ${e.message}`);
    return;
  }
  S.threads = threads;
  S.pickups = new Set(pickups.filter(([i]) => i >= 0 && i < threads.length).map(([i, r]) => pkey(i, r)));
  $("count").value = threads.length;
  clearHistory();
  S.fileName = name;
  S.fileHandle = handle;
  S.dirty = false;
  updateTitle();
  refresh();
  if (rng) setRange(rng[0], rng[1]); else selectFullRange();
}

function updateTitle() {
  $("fileName").textContent = S.fileName || "";
  document.title = S.fileName ? `${S.fileName} - Inkle Pattern Generator` : "Inkle Pattern Generator";
}

// ---------- tool box layout ----------

const narrow = window.matchMedia("(max-width: 700px)");

/** Reflow the tool boxes into the fewest columns (1-3) whose height fits the window without scrolling. */
function arrangeTools() {
  const tools = $("tools"), pane = $("toolsPane");
  if (narrow.matches) {
    tools.style.gridTemplateColumns = "repeat(auto-fill, minmax(280px, 1fr))";
    return;
  }
  for (const cols of [1, 2, 3]) {
    tools.style.gridTemplateColumns = `repeat(${cols}, max-content)`;
    if (tools.offsetHeight <= pane.clientHeight) break;
  }
}

// ---------- wiring ----------

function init() {
  bindPaint(preview.scroller, (e) => preview.point(e), onPreview);
  bindPaint(gridCanvas, (e) => {
    const rect = gridCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, onGrid);
  bindWheelZoom(preview.scroller, zoomBy);
  bindWheelZoom(repeatView.scroller, repeatZoomBy);

  const onEnter = (id, fn) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") fn(); });
  $("generateBtn").addEventListener("click", generate);
  onEnter("count", generate);
  $("zoom").addEventListener("input", redraw);
  $("zoomOut").addEventListener("click", () => zoomBy(-1));
  $("zoomIn").addEventListener("click", () => zoomBy(1));
  $("rotate").addEventListener("change", () => {
    S.rotated = $("rotate").checked;
    preview.scroller.scrollTo(0, 0);
    redraw();
  });
  $("undoBtn").addEventListener("click", undo);
  $("redoBtn").addEventListener("click", redo);
  $("addPreset").addEventListener("click", () => {
    if (!S.presets.includes(S.color)) { S.presets.push(S.color); presetsChanged(); }
  });
  $("resetPresets").addEventListener("click", () => {
    if (confirm("Restore the original preset palette? Your changes to the palette will be lost.")) {
      S.presets = DEFAULT_PRESETS.slice();
      presetsChanged();
    }
  });
  for (const n of ["R", "G", "B"]) $("s" + n).addEventListener("input", onSlider);
  $("rangeSet").addEventListener("click", applyRangeEntries);
  onEnter("rangeStart", applyRangeEntries);
  onEnter("rangeEnd", applyRangeEntries);
  $("fullRange").addEventListener("click", selectFullRange);
  $("openRepeat").addEventListener("click", openRepeat);
  onEnter("repeats", openRepeat);

  $("rUpdate").addEventListener("click", repeatRedraw);
  onEnter("rCount", repeatRedraw);
  $("rZoom").addEventListener("input", repeatRedraw);
  $("rZoomOut").addEventListener("click", () => repeatZoomBy(-1));
  $("rZoomIn").addEventListener("click", () => repeatZoomBy(1));
  $("rRotate").addEventListener("change", () => {
    R.rotated = $("rRotate").checked;
    repeatView.scroller.scrollTo(0, 0);
    repeatRedraw();
  });
  $("rClose").addEventListener("click", () => repeatDlg.close());

  $("openBtn").addEventListener("click", openFile);
  $("saveBtn").addEventListener("click", () => saveFile(false));
  $("saveAsBtn").addEventListener("click", () => saveFile(true));
  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) loadPattern(await file.text(), file.name);
  });
  // drop a .inkl file anywhere on the page to open it
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadPattern(await file.text(), file.name);
  });

  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const typing = e.target.matches && e.target.matches('input[type="number"], input[type="text"]');
    if (k === "z" && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === "y" && !typing) { e.preventDefault(); redo(); }
    else if (k === "s") { e.preventDefault(); saveFile(e.shiftKey); }
    else if (k === "o") { e.preventDefault(); openFile(); }
  });
  window.addEventListener("beforeunload", (e) => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  // redraw when anything changes size (window, tool reflow, repeat dialog)
  let pending = false;
  const ro = new ResizeObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      arrangeTools();
      refresh();
      repeatRedraw();
    });
  });
  for (const id of ["previewPane", "gridWrap", "toolsPane", "repeatPane"]) ro.observe($(id));

  setColor(S.color);
  updateUndoButtons();
  arrangeTools();
  refresh();
}

init();
