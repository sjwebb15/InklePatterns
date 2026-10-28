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
const TABLET_HOLES = "ABCD"; // a tablet's four holes, clockwise on its front face
const TABLET_TILT_DEG = 21; // lean angle of each tablet's oval, off vertical
const TABLET_FILL = 1.25; // how much of its own cell each oval occupies; >1 lets neighbors overlap
const TURN_CELL_W = 18; // width of one tablet's F/B cell in the turning-sequence editor
const TURN_LABEL_W = 84; // width of the row-number/delete/repeats area at the left of each block row
const TURN_NUM_W = 26; // the row number's part of that area; the delete "x" is in the next TURN_DEL_W px
const TURN_DEL_W = 20;
const TABLET_NUM_H = 18; // height of the tablet-number row above the threading grid's hole rows
const TRACE_ROWS = 32;
const FONT = "'Segoe UI', system-ui, sans-serif";

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

// ---------- tablet weaving (same as inkle.py) ----------

/** Which way a cell's oval tips: the tablet's Z/S threading, flipped whenever it's turning backward. */
function tabletLean(isZ, backwardPick) {
  return isZ !== backwardPick;
}

/** Picks in one full cycle of the turning sequence (sum of each block's repeat count). */
function turnBlocksTotal(blocks) {
  return blocks.reduce((sum, b) => sum + Math.max(0, b.repeats), 0);
}

/** "F", "B" or "I" (idle: the card doesn't turn this pick) for `tablet` at 1-indexed `pick`. Each
 *  block holds one state per tablet for its own repeat count; blocks run in order, then the whole
 *  sequence repeats. This is what lets different tablets turn differently at the same pick. */
function turnStateAt(blocks, tablet, pick) {
  const total = turnBlocksTotal(blocks);
  if (total <= 0) return "F";
  let pos = (pick - 1) % total;
  for (const b of blocks) {
    const reps = Math.max(0, b.repeats);
    if (pos < reps) return tablet < b.pattern.length ? b.pattern[tablet] : "I";
    pos -= reps;
  }
  return "I";
}

/** [block, isFirstPickOfThisOccurrence] for 1-indexed `pick`, or [null, false]. "First pick" is true
 *  every time the cycle comes back round to a block, since a flip is a per-block-entry event. */
function turnBlockEntryAt(blocks, pick) {
  const total = turnBlocksTotal(blocks);
  if (total <= 0) return [null, false];
  let pos = (pick - 1) % total;
  for (const b of blocks) {
    const reps = Math.max(0, b.repeats);
    if (pos < reps) return [b, pos === 0];
    pos -= reps;
  }
  return [null, false];
}

/** Yield [pick, state, holeIndex, isZNow] for picks 1..rows: which hole (0=A..3=D) shows, what the
 *  tablet did to get there, and its current threading. The single source of truth for both the
 *  preview and the trace, so they can't diverge.
 *  Hole order is the same for every tablet whatever its S/Z threading (S/Z only changes the lean):
 *  from home, forward turns show A, B, C, D, A...; backward turns show D, C, B, A, D... (matches
 *  published drafts). `rot` counts quarter turns: a forward pick shows hole `rot` then advances, a
 *  backward pick steps back then shows it, so a reversal repeats the previous pick's hole. Idle
 *  picks change nothing. A block's `flips` turn a card over (S<->Z) each time that block is
 *  reached. */
function* tabletHoleTrace(blocks, tablet, rows, homeIsZ) {
  let rot = 0, idx = 0;
  let isZNow = homeIsZ;
  for (let pick = 1; pick <= rows; pick++) {
    const [block, isEntry] = turnBlockEntryAt(blocks, pick);
    if (isEntry && block && block.flips && block.flips[tablet]) isZNow = !isZNow;
    const state = turnStateAt(blocks, tablet, pick);
    if (state === "F") {
      idx = ((rot % 4) + 4) % 4;
      rot++;
    } else if (state === "B") {
      rot--;
      idx = ((rot % 4) + 4) % 4;
    }
    yield [pick, state, idx, isZNow];
  }
}

/** Label every tablet if the numbers fit their columns, else every 2nd, 5th, 10th... one. */
function tabletLabelStep(cellW, n) {
  const need = String(n).length * 7 + 4;
  for (const step of [1, 2, 5, 10, 20, 50, 100]) if (cellW * step >= need) return step;
  return 100;
}

/** Draw the woven band: one tilted oval per tablet per pick, each centered in its own cell with no
 *  dependency on its neighbors. Pick 1 sits at `yBottom` and later picks stack upward, the way a
 *  band is woven and a draft is read. Only tablets cFrom..cTo are drawn (the visible ones). */
function drawTabletBand(ctx, colors, isZ, blocks, x0, yBottom, cellW, cellH, rows, cFrom = 0, cTo = colors.length - 1) {
  const halfLong = cellH / 2 * TABLET_FILL;
  const halfShort = cellW / 2 * TABLET_FILL * 0.85;
  const tilt = TABLET_TILT_DEG * Math.PI / 180;
  ctx.strokeStyle = HEX_LINE;
  ctx.lineWidth = 1;
  for (let col = Math.max(0, cFrom); col <= Math.min(cTo, colors.length - 1); col++) {
    const cx = x0 + (col + 0.5) * cellW;
    let angle = tabletLean(isZ[col], false) ? tilt : -tilt; // lean before this tablet ever turns
    for (const [pick, state, idx, isZNow] of tabletHoleTrace(blocks, col, rows, isZ[col])) {
      if (state !== "I") angle = tabletLean(isZNow, state === "B") ? tilt : -tilt; // idle: nothing moves
      const cy = yBottom - (pick - 0.5) * cellH;
      ctx.beginPath();
      ctx.ellipse(cx, cy, halfShort, halfLong, angle, 0, 2 * Math.PI);
      ctx.fillStyle = colors[col][idx] || EMPTY;
      ctx.fill();
      ctx.stroke();
    }
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

/** Left-click/drag paints, right-click/drag erases (also left with the Eraser box ticked).
 *  With `tapTouch`, a touch acts only as a tap, on release, so swiping can scroll the element instead. */
function bindPaint(el, pointOf, handler, { tapTouch = false } = {}) {
  let drag = null, tap = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const rect = el.getBoundingClientRect();
    if (e.clientX - rect.left >= el.clientWidth || e.clientY - rect.top >= el.clientHeight) return; // scrollbar
    const erase = e.button === 2 || $("eraser").checked;
    if (tapTouch && e.pointerType === "touch") {
      tap = { pt: pointOf(e), erase, shift: e.shiftKey };
      return;
    }
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    drag = { erase };
    handler(pointOf(e), drag.erase, true, e.shiftKey);
  });
  el.addEventListener("pointermove", (e) => {
    if (drag) handler(pointOf(e), drag.erase, false, e.shiftKey);
  });
  el.addEventListener("pointerup", () => {
    if (tap) handler(tap.pt, tap.erase, true, tap.shift);
    drag = tap = null;
  });
  el.addEventListener("pointercancel", () => { drag = tap = null; });
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
  weave: "inkle", // "inkle" (pick-up) or "tablet" (card weaving)
  threads: [], // color hex or null per thread; even index = heddled, odd = unheddled
  pickups: new Set(), // "thread,row": hexagon at that row is joined to the one two rows above
  range: [0, 0], // (first row, last row) of the preview used as the repeat unit
  visibleRows: 1,
  rotated: false,
  tabletColors: [], // per tablet: [A, B, C, D] hole colors, hex or null
  tabletSz: [], // per tablet: true = Z-threaded, false = S-threaded
  // turning sequence: blocks of {pattern: "F"/"B"/"I" per tablet, repeats, flips: bool per tablet},
  // run in order and then repeated -- lets different tablets reverse at different picks
  turnBlocks: [],
  activeTurnBlock: 0, // which block the bulk-edit buttons act on
  turnDragBlock: null,
  turnDragTarget: "B",
  turnShiftStroke: false, // whether the in-progress click/drag started as a flip
  color: "#DC143C",
  presets: loadPresets(),
  undo: [], redo: [], // pattern snapshots; one entry per click/drag stroke or Generate
  strokeSaved: false,
  pickTarget: true,
  rangeAnchor: null,
  fileName: null, fileHandle: null,
  dirty: false,
  geom: null, // preview geometry from the last redraw, for hit-testing
};

const mode = () => document.querySelector('input[name="mode"]:checked').value;
const isTablet = () => S.weave === "tablet";
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

const copyBlocks = (blocks) => blocks.map((b) => ({
  pattern: b.pattern.slice(), repeats: b.repeats, flips: (b.flips || b.pattern.map(() => false)).slice(),
}));

function snapshot() {
  if (isTablet()) {
    return { mode: "tablet", tabletColors: S.tabletColors.map((c) => c.slice()), tabletSz: S.tabletSz.slice(),
             turnBlocks: copyBlocks(S.turnBlocks) };
  }
  return { mode: "inkle", threads: S.threads.slice(), pickups: new Set(S.pickups) };
}

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

function restore(state) {
  if (state.mode === "tablet") {
    S.tabletColors = state.tabletColors.map((c) => c.slice());
    S.tabletSz = state.tabletSz.slice();
    S.turnBlocks = copyBlocks(state.turnBlocks);
    S.activeTurnBlock = Math.min(S.activeTurnBlock, S.turnBlocks.length - 1);
    $("count").value = S.tabletColors.length;
  } else {
    S.threads = state.threads.slice();
    S.pickups = new Set(state.pickups);
    $("count").value = S.threads.length;
  }
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
  const tablet = isTablet();
  const n = parseWhole($("count").value);
  if (!(n >= 1 && n <= 200)) {
    alert(`Enter a whole number of ${tablet ? "tablets" : "threads"} between 1 and 200.`);
    return;
  }
  const had = (tablet ? S.tabletColors : S.threads).length > 0;
  if (had) pushUndo(); // lets an accidental Generate be undone
  if (tablet) {
    S.tabletColors = Array.from({ length: n }, () => [null, null, null, null]);
    S.tabletSz = Array.from({ length: n }, (_, i) => i % 2 === 1);
    S.turnBlocks = defaultTurnBlocks(n);
    S.activeTurnBlock = 0;
  } else {
    S.threads = new Array(n).fill(null);
    S.pickups = new Set();
  }
  S.dirty = had;
  refresh();
  if (tablet) turnScrollToBottom(); // bottom-up: start with block 1 in view
  else selectFullRange();
}

/** Switch the tool boxes, grid and preview between inkle pick-up and tablet card weaving. */
function onWeaveTypeChange(reset = true) {
  const tablet = isTablet();
  $("warpTitle").textContent = tablet ? "Tablets" : "Warp threads";
  $("count").setAttribute("aria-label", tablet ? "Number of tablets" : "Number of warp threads");
  $("toolBox").hidden = tablet;
  $("repeatBox").hidden = tablet;
  $("turnBox").hidden = !tablet;
  if (tablet) {
    $("rotate").checked = false;
    S.rotated = false;
  }
  $("rotate").disabled = tablet;
  $("gridWrap").style.height = gridHeight() + "px";
  if (reset) {
    S.threads = [];
    S.pickups = new Set();
    S.tabletColors = [];
    S.tabletSz = [];
    S.turnBlocks = [];
    S.activeTurnBlock = 0;
    clearHistory();
    $("count").value = 15;
    S.fileName = null;
    S.fileHandle = null;
    S.dirty = false;
    updateTitle();
  }
  preview.scroller.scrollTo(0, 0);
  arrangeTools(); // shows the boxes for this type of weaving
  refresh();
  turnScrollToBottom();
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

// ---------- threading grid (H/U, or tablet holes A-D plus S/Z) ----------

const gridCanvas = $("gridCanvas");

function gridHeight() {
  return isTablet() ? PAD * 2 + TABLET_NUM_H + (TABLET_HOLES.length + 1) * CELL : PAD * 2 + 2 * CELL;
}

/** Width of one grid column: shrinks or grows so the whole grid always fits, no scrolling needed. */
function gridCellWidth(n = (isTablet() ? S.tabletColors : S.threads).length) {
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
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  if (isTablet()) drawTabletGrid(ctx);
  else drawInkleGrid(ctx);
}

function drawInkleGrid(ctx) {
  const n = S.threads.length;
  if (!n) return;
  const gcell = gridCellWidth(n), x0 = PAD + LABEL_W;
  ctx.font = "bold 15px " + FONT;
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

/** Tablet numbers (left to right), four hole rows (A-D, paintable), and an S/Z row (click to flip
 *  a tablet's threading). */
function drawTabletGrid(ctx) {
  const n = S.tabletColors.length;
  if (!n) return;
  const gcell = gridCellWidth(n), x0 = PAD + LABEL_W, top = PAD + TABLET_NUM_H;
  const step = tabletLabelStep(gcell, n);
  ctx.font = "11px " + FONT;
  ctx.fillStyle = "#1B1B1F";
  for (let i = step - 1; i < n; i += step) ctx.fillText(String(i + 1), x0 + (i + 0.5) * gcell, PAD + TABLET_NUM_H / 2);
  ctx.font = "bold 15px " + FONT;
  [...TABLET_HOLES].forEach((lab, r) => {
    ctx.fillStyle = "#1B1B1F";
    ctx.fillText(lab, PAD + LABEL_W / 2, top + r * CELL + CELL / 2);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = S.tabletColors[i][r] || EMPTY;
      ctx.fillRect(x0 + i * gcell, top + r * CELL, gcell, CELL);
      ctx.strokeRect(x0 + i * gcell, top + r * CELL, gcell, CELL);
    }
  });
  const szRow = TABLET_HOLES.length, y = top + szRow * CELL;
  ctx.font = "bold 12px " + FONT;
  ctx.fillStyle = "#1B1B1F";
  ctx.fillText("S/Z", PAD + LABEL_W / 2, y + CELL / 2);
  for (let i = 0; i < n; i++) {
    const isZ = S.tabletSz[i];
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(x0 + i * gcell, y, gcell, CELL);
    ctx.strokeRect(x0 + i * gcell, y, gcell, CELL);
    ctx.fillStyle = isZ ? "#6a7fb0" : "#b0756a";
    ctx.fillText(isZ ? "Z" : "S", x0 + (i + 0.5) * gcell, y + CELL / 2);
  }
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
  if (isTablet()) redrawTablet();
  else redrawInkle();
}

function redrawTablet() {
  const sc = preview.scroller;
  sc.style.overflowX = "scroll";
  sc.style.overflowY = "hidden";
  const w = preview.viewW, h = preview.viewH, n = S.tabletColors.length;
  if (!n) {
    S.geom = null;
    preview.setContentSize(w, h);
    preview.render();
    return;
  }
  const x0 = PAD + LABEL_W, yBottom = h - PAD; // pick 1 at the bottom, woven upward
  const availH = Math.max(h - 2 * PAD, 1);
  const cellW = zoomLevel() * 2;
  const cellH = Math.round(cellW * 1.8);
  const rows = Math.max(4, Math.floor(availH / cellH));
  S.visibleRows = rows;
  S.geom = { x0, yBottom, cellW, cellH, rows };
  preview.setContentSize(Math.max(x0 + n * cellW + PAD, w), h);
  preview.render();
}

function redrawInkle() {
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
    ctx.font = "16px " + FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const what = isTablet() ? "tablets" : "warp threads";
    ctx.fillText(`Enter the number of ${what} and click Generate`, sx + vw / 2, sy + vh / 2);
    return;
  }
  if (isTablet()) {
    const { x0, yBottom, cellW, cellH, rows } = S.geom;
    // draw only the tablets in view, plus one each side whose ovals overlap into it
    const cFrom = Math.floor((sx - x0) / cellW) - 1, cTo = Math.ceil((sx + vw - x0) / cellW) + 1;
    drawTabletBand(ctx, S.tabletColors, S.tabletSz, S.turnBlocks, x0, yBottom, cellW, cellH, rows, cFrom, cTo);
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
  if (isTablet()) return; // the tablet preview is read-only; edit threading and turning in the panels instead
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
  if (isTablet()) return onTabletGrid(pt, erase, press);
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

function onTabletGrid(pt, erase, press) {
  const n = S.tabletColors.length;
  if (!n) return;
  if (press) S.strokeSaved = false;
  const x0 = PAD + LABEL_W, top = PAD + TABLET_NUM_H;
  if (pt.x < x0 || pt.y < top) return;
  const i = Math.floor((pt.x - x0) / gridCellWidth(n));
  const row = Math.floor((pt.y - top) / CELL);
  if (i < 0 || i >= n || row < 0 || row > TABLET_HOLES.length) return;
  if (row === TABLET_HOLES.length) { // S/Z row: a left-click press flips the tablet's threading
    if (press && !erase) {
      checkpoint();
      S.tabletSz[i] = !S.tabletSz[i];
      refresh();
    }
    return;
  }
  const nv = erase ? null : S.color;
  if (S.tabletColors[i][row] !== nv) {
    checkpoint();
    S.tabletColors[i][row] = nv;
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

/** Redraw the threading grid, the preview, and (in tablet mode) the turning-sequence editor. */
function refresh() {
  drawGrid();
  redraw();
  if (isTablet()) drawTurnBlocks();
}

// ---------- turning sequence editor ----------

const turnCanvas = $("turnCanvas");

/** Classic 4F/4B, one row per pick like a printed draft. */
function defaultTurnBlocks(n) {
  return [..."FFFFBBBB"].map((d) => ({ pattern: new Array(n).fill(d), repeats: 1, flips: new Array(n).fill(false) }));
}

/** Drawn bottom-up, the way drafts are read: the first block is the bottom row and later blocks
 *  stack above it, with a row of tablet numbers underneath. Each block row has its delete and
 *  repeat-count controls on the left, then its per-tablet F/B/idle cells. */
function drawTurnBlocks() {
  const n = S.tabletColors.length, blocks = S.turnBlocks;
  const h = (blocks.length + 1) * CELL;
  const contentW = n && blocks.length ? TURN_LABEL_W + n * TURN_CELL_W : 1;
  const dpr = window.devicePixelRatio || 1;
  turnCanvas.style.width = contentW + "px";
  turnCanvas.style.height = h + "px";
  turnCanvas.width = Math.round(contentW * dpr);
  turnCanvas.height = Math.round(h * dpr);
  const ctx = turnCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, contentW, h);
  anchorTurnScroll();
  if (!n || !blocks.length) return;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "11px " + FONT;
  ctx.fillStyle = "#1B1B1F";
  for (let i = 0; i < n; i++) {
    ctx.fillText(String(i + 1), TURN_LABEL_W + (i + 0.5) * TURN_CELL_W, blocks.length * CELL + CELL / 2);
  }
  const fills = { F: "#C9A227", B: "#5B6B8C", I: CANVAS_BG };
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  blocks.forEach((b, bi) => {
    const y0 = (blocks.length - 1 - bi) * CELL;
    ctx.fillStyle = bi === S.activeTurnBlock ? "#E7EEF8" : CANVAS_BG;
    ctx.fillRect(0, y0, contentW, CELL);
    ctx.font = "11px " + FONT; // row number, counting up from 1 at the bottom
    ctx.fillStyle = "#6B6F76";
    ctx.textAlign = "right";
    ctx.fillText(String(bi + 1), TURN_NUM_W - 4, y0 + CELL / 2);
    ctx.textAlign = "center";
    ctx.font = "bold 13px " + FONT;
    ctx.fillStyle = "#A33333";
    ctx.fillText("×", TURN_NUM_W + TURN_DEL_W / 2, y0 + CELL / 2);
    ctx.font = "12px " + FONT;
    ctx.fillStyle = "#1B1B1F";
    ctx.fillText(b.repeats + "×", TURN_LABEL_W - 16, y0 + CELL / 2);
    const flips = b.flips || [];
    ctx.font = "bold 11px " + FONT;
    b.pattern.forEach((state, i) => {
      const x0 = TURN_LABEL_W + i * TURN_CELL_W;
      ctx.fillStyle = fills[state];
      ctx.fillRect(x0 + 1, y0 + 2, TURN_CELL_W - 2, CELL - 4);
      ctx.strokeRect(x0 + 1.5, y0 + 2.5, TURN_CELL_W - 3, CELL - 5);
      if (state !== "I") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(state, x0 + TURN_CELL_W / 2, y0 + CELL / 2);
      }
      if (flips[i]) { // flip marker: small triangle, top-right corner
        ctx.fillStyle = "#E8699A";
        ctx.beginPath();
        ctx.moveTo(x0 + TURN_CELL_W - 7, y0 + 2);
        ctx.lineTo(x0 + TURN_CELL_W - 1, y0 + 2);
        ctx.lineTo(x0 + TURN_CELL_W - 1, y0 + 8);
        ctx.closePath();
        ctx.fill();
      }
    });
  });
}

function onTurn(pt, erase, press, shift) {
  if (!S.turnBlocks.length || !S.tabletColors.length) return;
  if (press) S.strokeSaved = false;
  const { x, y } = pt, n = S.tabletColors.length;
  const row = Math.floor(y / CELL); // counted from the top; blocks are drawn bottom-up
  const nb = S.turnBlocks.length;
  if (row === nb) { // number row under the blocks: click a tablet's number to trace it
    if (press && x >= TURN_LABEL_W) {
      const tablet = Math.floor((x - TURN_LABEL_W) / TURN_CELL_W);
      if (tablet >= 0 && tablet < n) openTabletTrace(tablet);
    }
    return;
  }
  if (row < 0 || row >= nb) return;
  const blockIdx = nb - 1 - row;
  if (x < TURN_LABEL_W) {
    if (press) onTurnLabel(blockIdx, x, erase);
    return;
  }
  const tablet = Math.floor((x - TURN_LABEL_W) / TURN_CELL_W);
  if (tablet < 0 || tablet >= n) return;
  S.activeTurnBlock = blockIdx;
  const block = S.turnBlocks[blockIdx];
  if (press) S.turnShiftStroke = shift || $("flipMode").checked;
  if (S.turnShiftStroke) {
    // Shift+click (or Flip mode) toggles a flip; the whole stroke stays flip-only, so a pointer
    // drifting during the click can't fall through to painting F/B instead
    if (press) {
      checkpoint();
      if (!block.flips) block.flips = new Array(n).fill(false);
      block.flips[tablet] = !block.flips[tablet];
      drawTurnBlocks();
      redraw();
    }
    return;
  }
  const pattern = block.pattern;
  if (press) {
    S.turnDragBlock = blockIdx;
    S.turnDragTarget = pattern[tablet] === "B" ? "F" : "B";
  }
  if (S.turnDragBlock !== blockIdx) return;
  const nv = erase ? "I" : S.turnDragTarget;
  if (pattern[tablet] !== nv) {
    checkpoint();
    pattern[tablet] = nv;
    drawTurnBlocks();
    redraw();
  }
}

function onTurnLabel(blockIdx, x, erase) {
  if (x < TURN_NUM_W) return; // the row number itself does nothing
  if (x < TURN_NUM_W + TURN_DEL_W) { // delete glyph
    if (S.turnBlocks.length > 1 && !erase) {
      checkpoint();
      S.turnBlocks.splice(blockIdx, 1);
      S.activeTurnBlock = Math.min(S.activeTurnBlock, S.turnBlocks.length - 1);
      drawTurnBlocks();
      redraw();
    }
    return;
  }
  checkpoint(); // repeat count: left-click +1, right-click -1
  const b = S.turnBlocks[blockIdx];
  b.repeats = clamp(b.repeats + (erase ? -1 : 1), 1, 999);
  S.activeTurnBlock = blockIdx;
  drawTurnBlocks();
  redraw();
}

/** Add the number of rows in the "+ Add ... rows" box on top: all forward, 1x each (one undo step). */
function addTurnBlock() {
  const n = S.tabletColors.length;
  if (!n) return;
  const count = parseWhole($("addCount").value);
  if (!(count >= 1 && count <= 200)) {
    alert("Enter a whole number of rows to add, between 1 and 200.");
    return;
  }
  pushUndo();
  S.dirty = true;
  for (let i = 0; i < count; i++) {
    S.turnBlocks.push({ pattern: new Array(n).fill("F"), repeats: 1, flips: new Array(n).fill(false) });
  }
  S.activeTurnBlock = S.turnBlocks.length - 1;
  drawTurnBlocks();
  redraw();
}

function duplicateTurnBlock() {
  if (!S.turnBlocks.length) return;
  pushUndo();
  S.dirty = true;
  S.turnBlocks.push(copyBlocks(S.turnBlocks.slice(-1))[0]);
  S.activeTurnBlock = S.turnBlocks.length - 1;
  drawTurnBlocks();
  redraw();
}

function bulkTurnBlock(kind) {
  if (!S.turnBlocks.length) return;
  const b = S.turnBlocks[S.activeTurnBlock];
  pushUndo();
  S.dirty = true;
  if (kind === "f") b.pattern = b.pattern.map(() => "F");
  else if (kind === "b") b.pattern = b.pattern.map(() => "B");
  else if (kind === "evens") b.pattern = b.pattern.map((v, i) => ((i + 1) % 2 === 0 ? "B" : v));
  else if (kind === "odds") b.pattern = b.pattern.map((v, i) => ((i + 1) % 2 === 1 ? "B" : v));
  drawTurnBlocks();
  redraw();
}

// ---------- tablet trace ----------

const traceDlg = $("traceDlg");

function openTraceFromEntry() {
  const tablet = parseWhole($("traceNum").value) - 1;
  if (!(tablet >= 0 && tablet < S.tabletColors.length)) {
    alert(`Enter a tablet number between 1 and ${S.tabletColors.length}.`);
    return;
  }
  openTabletTrace(tablet);
}

/** Step-by-step table of one tablet's turns, holes and colors, for checking against a chart or a
 *  woven sample. Built from the same tabletHoleTrace() the preview draws from. A snapshot. */
function openTabletTrace(tablet) {
  if (!S.tabletColors.length) return;
  const colors = S.tabletColors[tablet], isZ = S.tabletSz[tablet];
  $("traceTitle").textContent = `Tablet ${tablet + 1} — ${isZ ? "Z" : "S"}-threaded, home = hole A`;
  const body = $("traceTable").tBodies[0];
  body.textContent = "";
  for (const [pick, state, idx, isZNow] of tabletHoleTrace(S.turnBlocks, tablet, TRACE_ROWS, isZ)) {
    const color = colors[idx] || EMPTY;
    const tr = body.insertRow();
    for (const v of [pick, state, TABLET_HOLES[idx], color, isZNow ? "Z" : "S"]) tr.insertCell().textContent = v;
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16));
    tr.style.background = color;
    tr.style.color = 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000000" : "#FFFFFF";
  }
  if (!traceDlg.open) traceDlg.showModal();
  $("traceWrap").scrollTop = 0;
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
  if (isTablet()) {
    return JSON.stringify({ version: 4, mode: "tablet", tablet_colors: S.tabletColors, tablet_sz: S.tabletSz,
                            turn_blocks: S.turnBlocks }, null, 1);
  }
  const pickups = [...S.pickups].map(unkey).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return JSON.stringify({ version: 2, mode: "inkle", threads: S.threads, pickups, range: S.range }, null, 1);
}

async function saveFile(saveAs = false) {
  if (!(isTablet() ? S.tabletColors : S.threads).length) {
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

/** Validate a tablet pattern's fields; returns [colors, sz, blocks] or throws. */
function readTabletData(data) {
  const isHex = (h) => h === null || (typeof h === "string" && HEX_RE.test(h));
  const colors = data.tablet_colors;
  if (!(Array.isArray(colors) && colors.length >= 1 && colors.length <= 200 &&
        colors.every((c) => Array.isArray(c) && c.length === 4 && c.every(isHex)))) {
    throw new Error("invalid tablet threading");
  }
  const n = colors.length;
  const sz = data.tablet_sz === undefined ? new Array(n).fill(false) : data.tablet_sz;
  if (!(Array.isArray(sz) && sz.length === n)) throw new Error("invalid S/Z list");
  let raw = data.turn_blocks;
  if (raw === undefined || raw === null) { // pre-individualized-turning files: a flat shared F/B unit
    const oldUnit = data.turn_unit === undefined ? [false, false, false, false, true, true, true, true] : data.turn_unit;
    if (!Array.isArray(oldUnit)) throw new Error("invalid turning sequence");
    raw = oldUnit.map((v) => ({ pattern: new Array(n).fill(v ? "B" : "F"), repeats: 1 }));
  }
  if (!(Array.isArray(raw) && raw.length >= 1 && raw.length <= 200)) throw new Error("invalid turning sequence");
  const blocks = raw.map((blk) => {
    const { pattern, repeats } = blk;
    if (!(Array.isArray(pattern) && pattern.length === n && pattern.every((v) => v === "F" || v === "B" || v === "I"))) {
      throw new Error("invalid turning block pattern");
    }
    if (!(Number.isInteger(repeats) && repeats >= 1 && repeats <= 999)) throw new Error("invalid turning block repeat count");
    const flips = blk.flips === undefined ? new Array(n).fill(false) : blk.flips; // v3 files predate flips
    if (!(Array.isArray(flips) && flips.length === n && flips.every((v) => typeof v === "boolean"))) {
      throw new Error("invalid turning block flips");
    }
    return { pattern: pattern.slice(), repeats, flips: flips.slice() };
  });
  return [colors, sz, blocks];
}

function loadPattern(text, name, handle = null) {
  let fileMode, threads, pickups, rng, colors, sz, blocks;
  try {
    const data = JSON.parse(text);
    fileMode = data.mode === "tablet" ? "tablet" : "inkle"; // files from before tablet mode are all inkle
    if (fileMode === "tablet") {
      [colors, sz, blocks] = readTabletData(data);
    } else {
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
    }
  } catch (e) {
    alert(`Could not read ${name}: ${e.message}`);
    return;
  }
  S.weave = fileMode;
  document.querySelector(`input[name="weave"][value="${fileMode}"]`).checked = true;
  onWeaveTypeChange(false);
  if (fileMode === "tablet") {
    S.tabletColors = colors.map((c) => c.slice());
    S.tabletSz = sz.map(Boolean);
    S.turnBlocks = blocks;
    S.activeTurnBlock = 0;
    $("count").value = colors.length;
  } else {
    S.threads = threads;
    S.pickups = new Set(pickups.filter(([i]) => i >= 0 && i < threads.length).map(([i, r]) => pkey(i, r)));
    $("count").value = threads.length;
  }
  clearHistory();
  S.fileName = name;
  S.fileHandle = handle;
  S.dirty = false;
  updateTitle();
  refresh();
  if (fileMode === "inkle") {
    if (rng) setRange(rng[0], rng[1]); else selectFullRange();
  } else {
    turnScrollToBottom();
  }
}

function updateTitle() {
  $("fileName").textContent = S.fileName || "";
  document.title = S.fileName ? `${S.fileName} - Inkle Pattern Generator` : "Inkle Pattern Generator";
}

// ---------- tool-box layout: flowing columns, drag to reorder, resizable boxes and columns (same as inkle.py) ----------

const narrow = window.matchMedia("(max-width: 700px)");
const LAYOUT_KEY = "inklePatterns.layout";
const TOOL_KEYS = ["warp", "zoom", "preset", "color", "tool", "repeat", "turn"]; // default tool-box order
const BOX_ID = { warp: "warpBox", zoom: "zoomBox", preset: "presetBox", color: "colorBox", tool: "toolBox",
                 repeat: "repeatBox", turn: "turnBox" };
const TOOL_GAP = 12; // space between boxes and around the columns (matches the CSS)
const TURN_MIN_W = 240; // the turning-sequence box can be narrower than its natural size (its grid scrolls)
let L = loadLayout(); // tool-box order, heights, and widths
let toolColumns = null; // current arrangement: [[key, ...], ...]
let flowAvailH = null; // panel height the current flow was worked out for
let resizingBox = false;

/** Split boxes (given by height, in order) into columns the way text flows: fill a column top to
 *  bottom, start the next when the next box won't fit, up to maxCols (the last one takes any
 *  overflow). Gives the fewest columns that fit, and keeps a dropped box where it was dropped. */
function flowColumns(heights, avail, maxCols = 3) {
  const cols = [[]];
  let used = 0;
  heights.forEach((h, i) => {
    if (cols[cols.length - 1].length && used + h > avail && cols.length < maxCols) {
      cols.push([]);
      used = 0;
    }
    cols[cols.length - 1].push(i);
    used += h;
  });
  return cols;
}

function defaultLayout() {
  return { order: TOOL_KEYS.slice(), heights: {}, widths: {} };
}

function loadLayout() {
  const layout = defaultLayout();
  let d;
  try { d = JSON.parse(localStorage.getItem(LAYOUT_KEY)); } catch (_) { return layout; }
  if (!d || typeof d !== "object") return layout;
  const valid = (n) => Number.isInteger(n) && n > 0 && n < 10000;
  if (Array.isArray(d.order)) {
    const order = [...new Set(d.order.filter((k) => TOOL_KEYS.includes(k)))];
    layout.order = order.concat(TOOL_KEYS.filter((k) => !order.includes(k))); // boxes added since
  }
  for (const field of ["heights", "widths"]) {
    if (d[field] && typeof d[field] === "object") {
      for (const [k, v] of Object.entries(d[field])) if (TOOL_KEYS.includes(k) && valid(v)) layout[field][k] = v;
    }
  }
  return layout;
}

function saveLayout() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(L)); } catch (_) { /* not persisted */ }
}

function resetLayout() {
  L = defaultLayout();
  saveLayout();
  arrangeTools(true);
}

const toolCols = () => [...document.querySelectorAll(".toolcol")];
const colDividers = () => [...document.querySelectorAll(".coldiv")];

/** Flow the visible tool boxes, in the user's order, into the fewest columns (1-3) that fit the
 *  height. Each column is its own stack with its own width, and its boxes fill that width.
 *  The flow is sticky: it's worked out afresh only when it has to be (force: a box was moved or the
 *  layout reset; or the boxes shown or the panel's height changed). Resizing a box or column
 *  re-wraps text and changes heights, but as long as every column still fits, boxes stay put
 *  rather than jumping between columns under the pointer. */
function arrangeTools(force = false) {
  if (resizingBox) return;
  const pane = $("toolsPane"), cols = toolCols();
  for (const k of TOOL_KEYS) applyBoxSize(k);
  const keys = L.order.filter((k) => !$(BOX_ID[k]).hidden);
  let columns;
  if (narrow.matches) {
    columns = [keys]; // stacked above the preview; the page scrolls
  } else {
    const avail = pane.clientHeight - 2 * TOOL_GAP + TOOL_GAP;
    const h = Object.fromEntries(keys.map((k) => [k, $(BOX_ID[k]).offsetHeight + TOOL_GAP]));
    const cur = toolColumns;
    const keep = !force && avail === flowAvailH && cur && cur.flat().join() === keys.join() &&
      cur.every((col) => col.length === 1 || col.reduce((s, k) => s + h[k], 0) <= avail);
    flowAvailH = avail;
    columns = keep ? cur : flowColumns(keys.map((k) => h[k]), avail).map((c) => c.map((i) => keys[i]));
  }
  if (force || JSON.stringify(columns) !== JSON.stringify(toolColumns)) {
    toolColumns = columns;
    cols.forEach((c, i) => { c.hidden = i >= columns.length; });
    colDividers().forEach((d, i) => { d.hidden = i >= columns.length - 1; });
    columns.forEach((col, i) => { for (const k of col) cols[i].appendChild($(BOX_ID[k])); });
  }
  sizeToolColumns();
  anchorTurnScroll(); // moving or resizing boxes can reset the grid's scroll position
}

/** Natural width of a box: what its contents need (help text re-wraps, so doesn't count). */
function naturalBoxWidth(key) {
  const b = $(BOX_ID[key]);
  b.style.width = "max-content";
  const w = b.offsetWidth;
  b.style.width = "";
  return w;
}

const minBoxWidth = (key) => (key === "turn" ? TURN_MIN_W : naturalBoxWidth(key));

/** A column's width: as wide as its widest box -- the width the user gave a box, or else its
 *  natural width -- but never narrower than every box in it allows. Widths belong to the boxes,
 *  not the columns, so a box keeps its width when it flows into another column. */
function columnWidth(c) {
  const keys = (toolColumns || [])[c] || [];
  if (!keys.length) return 0;
  const minimum = Math.max(...keys.map(minBoxWidth));
  const users = keys.filter((k) => L.widths[k]).map((k) => L.widths[k]);
  return Math.max(minimum, ...(users.length ? users : keys.map(naturalBoxWidth)));
}

function sizeToolColumns() {
  toolCols().forEach((col, c) => {
    col.style.width = narrow.matches || c >= (toolColumns || []).length ? "" : columnWidth(c) + "px";
  });
}

/** Give a box the user's height, or let it size to its contents; its width comes from its column.
 *  Other boxes never get shorter than their contents (the height is a minimum); the turning-
 *  sequence box can, down to its controls plus a couple of rows, since its grid scrolls. */
function applyBoxSize(key) {
  const b = $(BOX_ID[key]), h = narrow.matches ? null : L.heights[key];
  if (key !== "turn") {
    b.style.minHeight = h ? h + "px" : "";
    return;
  }
  b.style.height = "";
  if (h) b.style.height = Math.max(h, minBoxHeight(key)) + "px";
  anchorTurnScroll(); // keep block 1 in view as the grid area grows or shrinks
}

/** Shortest a box may be made (measured with the user's height taken off). */
function minBoxHeight(key) {
  const b = $(BOX_ID[key]), st = b.style;
  const saved = [st.height, st.minHeight];
  st.height = st.minHeight = "";
  let h = b.offsetHeight;
  if (key === "turn") h = h - $("turnScroll").offsetHeight + 2 * CELL + 16; // controls + two rows + scrollbar
  [st.height, st.minHeight] = saved;
  if (key === "turn") anchorTurnScroll(); // measuring at full height reset the grid's scroll position
  return h;
}

const columnOf = (key) => (toolColumns || []).findIndex((col) => col.includes(key));

/** Set column c's width live (while a divider or grip is being dragged), by giving every box in
 *  it that width. */
function setColumnWidth(c, w) {
  w = Math.max(Math.max(...toolColumns[c].map(minBoxWidth)), Math.round(w));
  for (const k of toolColumns[c]) L.widths[k] = w;
  sizeToolColumns();
  anchorTurnScroll();
}

/** Drag a box by its title to move it: a blue line shows where it will land. */
function bindBoxDrag(key) {
  const b = $(BOX_ID[key]), title = b.querySelector("h2");
  let d = null;
  title.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || narrow.matches) return;
    e.preventDefault();
    try { title.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    d = { x: e.clientX, y: e.clientY, moved: false, target: null };
  });
  title.addEventListener("pointermove", (e) => {
    if (!d || (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 5)) return;
    d.moved = true;
    b.classList.add("dragging");
    d.target = boxDropTarget(e.clientX, e.clientY);
    showDropMark(d.target);
  });
  const end = () => {
    if (!d) return;
    const { moved, target } = d;
    d = null;
    b.classList.remove("dragging");
    $("dropMark").hidden = true;
    if (moved && target && target[0] !== key) {
      const order = L.order.filter((k) => k !== key);
      order.splice(order.indexOf(target[0]) + (target[1] ? 0 : 1), 0, key);
      L.order = order;
      saveLayout();
      arrangeTools(true);
    }
  };
  title.addEventListener("pointerup", end);
  title.addEventListener("pointercancel", end);
}

/** [box key, before?] for a drop at a point: the column nearest the pointer, then the first box in
 *  it whose middle is below the pointer (else after its last box). */
function boxDropTarget(x, y) {
  const cols = toolCols();
  let best = null;
  (toolColumns || []).forEach((col, i) => {
    if (!col.length) return;
    const r = cols[i].getBoundingClientRect();
    const dist = x >= r.left && x < r.right ? 0 : Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
    if (!best || dist < best[0]) best = [dist, col];
  });
  if (!best) return null;
  for (const k of best[1]) {
    const r = $(BOX_ID[k]).getBoundingClientRect();
    if (y < r.top + r.height / 2) return [k, true];
  }
  return [best[1][best[1].length - 1], false];
}

function showDropMark(target) {
  const m = $("dropMark");
  if (!target) { m.hidden = true; return; }
  const r = $(BOX_ID[target[0]]).getBoundingClientRect();
  m.style.left = r.left + "px";
  m.style.width = r.width + "px";
  m.style.top = (target[1] ? r.top - TOOL_GAP / 2 - 2 : r.bottom + TOOL_GAP / 2 - 1) + "px";
  m.hidden = false;
}

/** Drag a box's corner grip: up/down sets the box's height, left/right its column's width.
 *  Double-click the grip to give the box back its natural height. */
function bindGrip(key) {
  const b = $(BOX_ID[key]), grip = document.createElement("div");
  grip.className = "grip";
  grip.title = "Drag to resize (sideways resizes the whole column); double-click to reset the height";
  b.appendChild(grip);
  let r = null;
  grip.addEventListener("pointerdown", (e) => {
    const c = columnOf(key);
    if (e.button !== 0 || c < 0) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    r = { x: e.clientX, y: e.clientY, col: c, w: columnWidth(c), h: b.offsetHeight };
    resizingBox = true;
  });
  grip.addEventListener("pointermove", (e) => {
    if (!r) return;
    setColumnWidth(r.col, r.w + e.clientX - r.x);
    // measured fresh each time: re-wrapped text changes the minimum as the width changes
    L.heights[key] = Math.max(minBoxHeight(key), Math.round(r.h + e.clientY - r.y));
    applyBoxSize(key);
  });
  const end = () => {
    if (!r) return;
    r = null;
    resizingBox = false;
    saveLayout();
    arrangeTools();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("dblclick", () => {
    delete L.heights[key];
    saveLayout();
    arrangeTools();
  });
}

/** Drag a divider to set the width of the column on its left; double-click it to reset that
 *  column. (The divider beside the preview does the same for the last column.) */
function bindColumnDivider(div, colIndex) {
  let r = null;
  div.addEventListener("pointerdown", (e) => {
    const c = colIndex();
    if (e.button !== 0 || c < 0 || c >= (toolColumns || []).length) return;
    e.preventDefault();
    try { div.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    r = { x: e.clientX, c, w: columnWidth(c) };
    resizingBox = true;
  });
  div.addEventListener("pointermove", (e) => {
    if (r) setColumnWidth(r.c, r.w + e.clientX - r.x);
  });
  const end = () => {
    if (!r) return;
    r = null;
    resizingBox = false;
    saveLayout();
    arrangeTools();
  };
  div.addEventListener("pointerup", end);
  div.addEventListener("pointercancel", end);
  div.addEventListener("dblclick", () => {
    const c = colIndex();
    if (c < 0) return;
    for (const k of toolColumns[c] || []) delete L.widths[k];
    saveLayout();
    arrangeTools();
  });
  div.addEventListener("keydown", (e) => {
    const c = colIndex();
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || c < 0 || c >= (toolColumns || []).length) return;
    e.preventDefault();
    setColumnWidth(c, columnWidth(c) + (e.key === "ArrowLeft" ? -16 : 16));
    saveLayout();
    arrangeTools();
  });
}

// the turning grid reads bottom-up: when its box is resized or blocks are added on top, keep the
// same distance from the bottom (block 1) in view; a browser on its own keeps the top fixed
let turnFromBottom = 0;

function anchorTurnScroll() {
  const s = $("turnScroll");
  s.scrollTop = s.scrollHeight - s.clientHeight - turnFromBottom;
}

function turnScrollToBottom() {
  turnFromBottom = 0;
  anchorTurnScroll();
}

// ---------- wiring ----------

function init() {
  // tool boxes: column stacks to flow them into, a drop marker, and per-box drag and resize handles
  const tools = $("tools"), first = tools.firstChild;
  for (let i = 0; i < 3; i++) {
    const col = document.createElement("div");
    col.className = "toolcol";
    tools.insertBefore(col, first);
    if (i < 2) {
      const div = document.createElement("div");
      div.className = "coldiv";
      div.title = "Drag to resize the column; double-click to reset it";
      tools.insertBefore(div, first);
      bindColumnDivider(div, () => i);
    }
  }
  // the divider beside the preview is the right edge of the last tool column
  bindColumnDivider($("splitter"), () => (toolColumns || []).length - 1);
  const mark = document.createElement("div");
  mark.id = "dropMark";
  mark.hidden = true;
  document.body.appendChild(mark);
  for (const k of TOOL_KEYS) {
    bindBoxDrag(k);
    bindGrip(k);
  }
  $("resetLayout").addEventListener("click", resetLayout);
  $("turnScroll").addEventListener("scroll", () => {
    const s = $("turnScroll");
    turnFromBottom = s.scrollHeight - s.clientHeight - s.scrollTop;
  });

  bindPaint(preview.scroller, (e) => preview.point(e), onPreview);
  bindPaint(gridCanvas, (e) => {
    const rect = gridCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, onGrid);
  bindPaint(turnCanvas, (e) => {
    const rect = turnCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, onTurn, { tapTouch: true });
  bindWheelZoom(preview.scroller, zoomBy);
  bindWheelZoom(repeatView.scroller, repeatZoomBy);

  const onEnter = (id, fn) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") fn(); });
  for (const r of document.querySelectorAll('input[name="weave"]')) {
    r.addEventListener("change", () => {
      if (S.dirty && !confirm("Switching the type of weaving starts a new, blank pattern. Discard your unsaved changes?")) {
        document.querySelector(`input[name="weave"][value="${S.weave}"]`).checked = true;
        return;
      }
      S.weave = r.value;
      onWeaveTypeChange();
    });
  }
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

  $("addBlock").addEventListener("click", addTurnBlock);
  onEnter("addCount", addTurnBlock);
  $("dupBlock").addEventListener("click", duplicateTurnBlock);
  $("bulkF").addEventListener("click", () => bulkTurnBlock("f"));
  $("bulkB").addEventListener("click", () => bulkTurnBlock("b"));
  $("bulkEvens").addEventListener("click", () => bulkTurnBlock("evens"));
  $("bulkOdds").addEventListener("click", () => bulkTurnBlock("odds"));
  $("traceGo").addEventListener("click", openTraceFromEntry);
  onEnter("traceNum", openTraceFromEntry);
  $("traceClose").addEventListener("click", () => traceDlg.close());

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
  // a box changing height (e.g. blocks added) can change how the boxes flow into columns
  let boxPending = false;
  const boxRo = new ResizeObserver(() => {
    if (boxPending) return;
    boxPending = true;
    requestAnimationFrame(() => {
      boxPending = false;
      arrangeTools();
      anchorTurnScroll();
    });
  });
  for (const k of TOOL_KEYS) boxRo.observe($(BOX_ID[k]));
  boxRo.observe($("turnScroll"));

  // a reload can restore form state; start from the inkle defaults the state above describes
  document.querySelector('input[name="weave"][value="inkle"]').checked = true;
  setColor(S.color);
  updateUndoButtons();
  onWeaveTypeChange(false);
}

init();
