"""Inkle weaving pattern generator."""
import json
import math
import os
import re
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import sv_ttk

PRESETS = [
    "#000000", "#404040", "#808080", "#C0C0C0", "#FFFFFF", "#F5F5DC",
    "#8B0000", "#DC143C", "#FF0000", "#FF7F50", "#FFA500", "#FFD700",
    "#FFFF00", "#9ACD32", "#32CD32", "#006400", "#008080", "#00FFFF",
    "#87CEEB", "#1E90FF", "#0000CD", "#000080", "#4B0082", "#8A2BE2",
    "#FF69B4", "#FF00FF", "#800080", "#A52A2A", "#8B4513", "#D2B48C",
]

if getattr(sys, "frozen", False):
    # PyInstaller one-file build: the exe unpacks to a temp dir that's wiped on exit, so keep
    # the user's edited palette in %APPDATA%; the bundled presets.json only seeds the first run.
    PRESETS_FILE = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "InklePatterns", "presets.json")
    DEFAULT_PRESETS_FILE = os.path.join(sys._MEIPASS, "presets.json")
else:
    PRESETS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presets.json")
    DEFAULT_PRESETS_FILE = None
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

LABEL_W = 36
CELL = 24  # fixed height of the H/U grid cells; width is dynamic, see grid_cell_width()
GRID_CELL_MIN, GRID_CELL_MAX = 2, 60  # bounds on the dynamic H/U grid cell width
GRID_H = 2 * CELL
ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT = 2, 20, 4  # hexagon half-width in pixels
UNDO_LIMIT = 500  # max undo steps kept
PAD = 10
EMPTY = "#FFFFFF"
LINE = "#C8CCD2"  # grid cell outlines
HEX_LINE = "#3A3A3A"  # hexagon outlines
CANVAS_BG = "#F0F1F3"
HINT = "#6B6F76"
SWATCH = 22  # preset swatch size in pixels
SWATCH_GAP = 3
SWATCH_COLS = 10
TABLET_HOLES = "ABCD"  # a tablet's four holes, clockwise on its front face
TABLET_TILT_DEG = 21  # lean angle of each tablet's oval, off vertical
TABLET_FILL = 1.25  # how much of its own cell each oval occupies; >1 lets neighbors overlap
TURN_CELL_W = 18  # width of one tablet's F/B cell in the turning-sequence editor
TURN_LABEL_W = 56  # width of the repeats/delete control area at the left of each block row


def hex_dims(hw):
    a = hw * 0.7
    spacing = 4.8 * hw - a
    return a, spacing


def hex_poly(px, hw, py, a, spacing, r, i, rotated=False):
    """Hexagon for thread `i`, row `r`. `px` is the origin across threads, `py` the origin along rows.
    Unrotated: pointy top/bottom, threads run horizontally. Rotated 90 deg: pointy left/right, threads run
    vertically and rows run horizontally (so a long, narrow band can be viewed running left-to-right)."""
    hh = spacing + a
    if rotated:
        cy = px + (i + 1) * hw
        x = py + r * spacing
        return [(x, cy), (x + a, cy - hw), (x + hh - a, cy - hw),
                (x + hh, cy), (x + hh - a, cy + hw), (x + a, cy + hw)]
    cx = px + (i + 1) * hw
    y = py + r * spacing
    return [(cx, y), (cx + hw, y + a), (cx + hw, y + hh - a),
            (cx, y + hh), (cx - hw, y + hh - a), (cx - hw, y + a)]


def draw_honeycomb(canvas, threads, pickups, x0, py, hw, a, spacing, rows, hex_line=HEX_LINE, rotated=False):
    """Draw a honeycomb of `rows` rows for `threads`, with pick-up bars for cells in `pickups`."""
    n = len(threads)
    for r in range(rows):
        for i in range(r % 2, n, 2):
            pts = [v for p in hex_poly(x0, hw, py, a, spacing, r, i, rotated) for v in p]
            canvas.create_polygon(pts, fill=threads[i] or EMPTY, outline=hex_line)
    # pick-ups: the hexagon is stretched up to the next hexagon in its column, passing over the row between
    for i, r in pickups:
        if r - 2 < 0 or r >= rows or i >= n:
            continue
        up = hex_poly(x0, hw, py, a, spacing, r - 2, i, rotated)
        low = hex_poly(x0, hw, py, a, spacing, r, i, rotated)
        pts = [v for p in (up[0], up[1], low[2], low[3], low[4], up[5]) for v in p]
        canvas.create_polygon(pts, fill=threads[i] or EMPTY, outline=hex_line)


def tablet_lean(is_z, backward_pick):
    """Which way a cell's eye tips: the tablet's Z/S threading, flipped whenever it's currently
    turning backward. Two stacked cells with the same lean share a pointed seam; otherwise, flat."""
    return is_z != backward_pick


def turn_blocks_total(blocks):
    """Picks in one full cycle of the turning sequence (sum of each block's repeat count)."""
    return sum(max(0, b["repeats"]) for b in blocks)


def turn_state_at(blocks, tablet, pick):
    """'F', 'B', or 'I' (idle -- the card doesn't turn this pick) for `tablet` at 1-indexed pick
    `pick`. Each block holds one state per tablet, repeated for that block's own repeat count;
    blocks run in order and then the whole sequence repeats. This is what lets different tablets
    turn differently at the same pick (the "twist" tablets in a Greek-key or ram's-horn chart, or
    idle tablets in a diagonal Greek-key chart) without anything else needing to know."""
    total = turn_blocks_total(blocks)
    if total <= 0:
        return "F"
    pos = (pick - 1) % total
    for b in blocks:
        reps = max(0, b["repeats"])
        if pos < reps:
            pattern = b["pattern"]
            return pattern[tablet] if tablet < len(pattern) else "I"
        pos -= reps
    return "I"


def turn_backward_at(blocks, tablet, pick):
    """Whether `tablet` turns backward at 1-indexed pick `pick` (idle counts as not-backward)."""
    return turn_state_at(blocks, tablet, pick) == "B"


def turn_block_entry_at(blocks, pick):
    """Return (block, is_first_pick_of_this_occurrence) for 1-indexed pick -- (None, False) if
    there are no blocks or the sequence has zero total repeats. "First pick of this occurrence"
    is true every time the cycle wraps back around to a block, not just the very first cycle,
    since a flip (see tablet_hole_trace) is a per-block-entry event, like the F/B/I pattern it
    sits alongside."""
    total = turn_blocks_total(blocks)
    if total <= 0:
        return None, False
    pos = (pick - 1) % total
    for b in blocks:
        reps = max(0, b["repeats"])
        if pos < reps:
            return b, pos == 0
        pos -= reps
    return None, False


def tablet_hole_trace(blocks, tablet, rows, home_is_z):
    """Yield (pick, state, hole_index, is_z_now) for picks 1..rows: which hole (0=A..3=D) faces
    front, what that tablet was doing (F/B/I) to get there, and its CURRENT threading (which can
    change mid-pattern -- see flips, below). The single source of truth for "which hole shows and
    how it leans" -- both the renderer and the trace/debug view call this, so they can't diverge.

    Hole rotation order is the SAME for every tablet regardless of S/Z threading -- it's a fixed
    physical fact of the card (confirmed 2026-10-20): labeled clockwise A,B,C,D starting at the
    top-right corner (home position: A top-right, B bottom-right, C bottom-left, D top-left, with
    D nearest the weaver), a forward turn is clockwise, and clockwise rotation carries the hole
    that was at top-left into top-right -- so forward DECREMENTS the index (A->D->C->B->A), not
    increments it. S/Z only changes the lean (tablet_lean), never which hole is active.

    A turn in the same direction as the tablet's previous turn advances to the next hole; a turn
    in the OPPOSITE direction (a reversal) does NOT advance -- the same hole repeats for that pick.
    This is real physical behavior, not an approximation: a forward run ending on hole D followed
    by a backward run starting on D is what makes those two adjacent picks the same color, visible
    in a woven band as a longer thread bridging across the reversal. Idle picks never change idx
    and don't count as "the previous turn" when the next real turn checks for a reversal.

    Flipping (physically turning a card over) swaps its S/Z threading from that point on, without
    touching hole rotation (which never depended on S/Z) -- real weavers use this to redirect the
    diagonal lean mid-band without re-threading. A block's optional "flips" list (one bool per
    tablet, parallel to "pattern") marks tablets that flip the moment that block is reached; this
    re-applies every time the cycle revisits that block, same as the F/B/I pattern it sits beside
    -- a tablet marked to flip in a block that recurs every cycle flips back and forth each time."""
    idx = 0
    last_dir = None  # last non-idle direction ("F" or "B"), ignoring idle picks entirely
    is_z_now = home_is_z
    for pick in range(1, rows + 1):
        block, is_entry = turn_block_entry_at(blocks, pick)
        if is_entry and block is not None:
            flips = block.get("flips")
            if flips and tablet < len(flips) and flips[tablet]:
                is_z_now = not is_z_now
        state = turn_state_at(blocks, tablet, pick)
        if state != "I":
            if last_dir is None or state == last_dir:
                idx = (idx + (-1 if state == "F" else 1)) % 4
            # else: reversal -- idx repeats the previous pick's hole, no advance
            last_dir = state
        yield pick, state, idx, is_z_now


def ellipse_points(cx, cy, rx, ry, angle, n=24):
    """Vertices of an ellipse (radii rx, ry) rotated by `angle` radians about (cx, cy). Tkinter's
    canvas has no native rotated-ellipse primitive, so a smoothed many-point polygon stands in."""
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((cx + x * cos_a - y * sin_a, cy + x * sin_a + y * cos_a))
    return pts


def draw_tablet_band(canvas, colors, is_z, blocks, x0, y0, cell_w, cell_h, rows,
                     tilt_deg=TABLET_TILT_DEG, fill=TABLET_FILL, line=HEX_LINE):
    """Draw the woven band: one tilted oval per tablet per pick, each centered and rotated within
    its own cell with no dependency on its neighbors. A tablet's own turning sequence (which may
    differ from every other tablet's) is just a lean and a hole-rotation count computed purely
    from its own history -- there's no shared edge between cells to keep in sync, so individualized
    turning (different tablets reversing at different picks) needs no special handling at all."""
    n = len(colors)
    half_long = cell_h / 2 * fill
    half_short = cell_w / 2 * fill * 0.85
    tilt = math.radians(tilt_deg)
    for col in range(n):
        cx = x0 + (col + 0.5) * cell_w
        angle = tilt if tablet_lean(is_z[col], False) else -tilt  # lean before this tablet ever turns
        for pick, state, idx, is_z_now in tablet_hole_trace(blocks, col, rows, is_z[col]):
            if state != "I":  # idle: the card doesn't move, so its rotation and lean don't change
                angle = tilt if tablet_lean(is_z_now, state == "B") else -tilt
            cy = y0 + (pick - 0.5) * cell_h
            pts = [v for p in ellipse_points(cx, cy, half_short, half_long, angle) for v in p]
            color = colors[col][idx] or EMPTY
            canvas.create_polygon(pts, fill=color, outline=line, smooth=True)


class InkleApp(tk.Tk):
    def __init__(self):
        super().__init__()
        sv_ttk.set_theme("light")
        self.title("Inkle Pattern Generator")
        self.geometry("1100x800")
        self.minsize(760, 560)
        self.weave_var = tk.StringVar(value="inkle")  # 'inkle' (pick-up) or 'tablet' (card weaving)
        self.threads = []  # color hex or None per thread
        self.pickups = set()  # (thread, row): hexagon at that row is joined to the next one in its column
        self._pick_target = True
        self.range = (0, 0)  # (first row, last row) of the preview used as the repeat unit
        self._visible_rows = 1  # rows currently drawn in the preview, at the current zoom/window size
        self._range_anchor = None
        self.rotated = False  # rotate the preview 90 deg: rows run left-to-right, threads run top-to-bottom
        self.tablet_colors = []  # per tablet: [A, B, C, D] hole colors, hex or None
        self.tablet_sz = []  # per tablet: True = Z-threaded, False = S-threaded
        # turning sequence: a list of blocks, each {"pattern": [bool per tablet], "repeats": int};
        # blocks run in order, each one's per-tablet F/B held for its own repeat count, then the
        # whole sequence repeats -- lets different tablets reverse at different picks.
        self.turn_blocks = []
        self._active_turn_block = 0  # which block the bulk-edit buttons act on
        self._turn_drag_block = None
        self._turn_drag_target = True
        self._turn_shift_stroke = False  # whether the in-progress click/drag started with Shift held
        self.path = None  # current .inkl file
        # undo/redo history of pattern snapshots; one entry per click/drag stroke or Generate
        self._undo = []
        self._redo = []
        self._stroke_saved = False  # whether the current stroke has already pushed its undo snapshot
        self.presets = self._load_presets()
        self.color = "#DC143C"
        self._build_menu()
        # H/U (or tablet threading) grid: full window width, at the very top; cell width scales to fit
        self.grid_canvas = tk.Canvas(self, bg=CANVAS_BG, height=self.grid_height(), highlightthickness=0)
        self.grid_canvas.pack(side="top", fill="x")
        self.grid_canvas.bind("<Configure>", lambda e: self.draw_grid())
        self.grid_canvas.bind("<Button-1>", lambda e: self.on_grid_click(e, False, True))
        self.grid_canvas.bind("<B1-Motion>", lambda e: self.on_grid_click(e, False))
        self.grid_canvas.bind("<Button-3>", lambda e: self.on_grid_click(e, True, True))
        self.grid_canvas.bind("<B3-Motion>", lambda e: self.on_grid_click(e, True))
        ttk.Separator(self, orient="horizontal").pack(side="top", fill="x")

        # below the grid: tools on the left, preview filling the rest, sharing the remaining height.
        # A PanedWindow (not a plain Frame) so the user can drag the divider to widen the tools
        # panel themselves -- useful for the turning-sequence grid, which otherwise needs its own
        # horizontal scrollbar for wide patterns.
        paned = ttk.PanedWindow(self, orient="horizontal")
        paned.pack(side="top", fill="both", expand=True)
        self.tools_container = tools_container = ttk.Frame(paned)
        self._build_controls(tools_container)
        tools_container.bind("<Configure>", self._on_tools_configure)
        paned.add(tools_container, weight=0)

        right = ttk.Frame(paned)
        paned.add(right, weight=1)
        # honeycomb preview: size set by zoom only; scrolls in whichever direction threads can overflow
        self.canvas = tk.Canvas(right, bg=CANVAS_BG, highlightthickness=0)
        self.hbar = ttk.Scrollbar(right, orient="horizontal", command=self.canvas.xview)
        self.vbar = ttk.Scrollbar(right, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(xscrollcommand=self.hbar.set, yscrollcommand=self.vbar.set)
        self._layout_preview_scrollbars()
        self.canvas.bind("<Configure>", lambda e: self.redraw())
        self.canvas.bind("<Control-MouseWheel>", lambda e: self.zoom_by(1 if e.delta > 0 else -1))
        self.canvas.bind("<Button-1>", lambda e: self.on_click(e, False, True))
        self.canvas.bind("<B1-Motion>", lambda e: self.on_click(e, False))
        self.canvas.bind("<Button-3>", lambda e: self.on_click(e, True, True))
        self.canvas.bind("<B3-Motion>", lambda e: self.on_click(e, True))
        self.set_color(self.color)
        self._update_undo_buttons()
        self._on_weave_type_change(reset=False)  # hide/show the right tool boxes for the default mode

    def _layout_preview_scrollbars(self):
        """Unrotated: threads run horizontally, scroll horizontally. Rotated: threads run vertically, scroll
        vertically. The row/length axis always just adds or removes rows/columns to fit, never scrolls."""
        self.hbar.pack_forget()
        self.vbar.pack_forget()
        self.canvas.pack_forget()
        if self.rotated:
            self.vbar.pack(side="right", fill="y")
        else:
            self.hbar.pack(side="bottom", fill="x")
        self.canvas.pack(side="top", fill="both", expand=True)

    def toggle_rotate(self):
        self.rotated = self._rotate_var.get()
        self._layout_preview_scrollbars()
        self.redraw()

    def _on_tools_configure(self, event=None):
        """Reflow the tool boxes into 1-3 columns so they always fit the available height without scrolling."""
        avail_h = event.height if event is not None else self.tools_container.winfo_height()
        if avail_h <= 1 or not self.tool_boxes:
            return
        heights = [f.winfo_reqheight() for f in self.tool_boxes]
        chosen = 3
        for cols in (1, 2, 3):
            col_heights = [0] * cols
            for idx, h in enumerate(heights):
                col_heights[idx % cols] += h
            if max(col_heights) <= avail_h:
                chosen = cols
                break
        if chosen != self._tool_cols:
            self._tool_cols = chosen
            self._arrange_tools(chosen)

    def _arrange_tools(self, cols):
        parent = self.tool_boxes[0].master
        for c in range(3):
            parent.columnconfigure(c, weight=1 if c < cols else 0)
        for idx, f in enumerate(self.tool_boxes):
            # the turning-sequence box stretches to use any extra width the user drags in (so its
            # tablet grid needs less horizontal scrolling); other boxes stay their natural size.
            sticky = "new" if f is getattr(self, "turn_f", None) else "nw"
            f.grid(row=idx // cols, column=idx % cols, sticky=sticky, padx=6, pady=6)

    def _build_controls(self, parent):
        # a set of labeled tool boxes that reflow into however many columns fit the available height
        self.tool_boxes = []
        self._tool_cols = None

        def box(text):
            f = ttk.LabelFrame(parent, text=text, padding=10)
            self.tool_boxes.append(f)
            return f

        def hint(parent, text):
            ttk.Label(parent, text=text, foreground=HINT, justify="left").pack(anchor="w", pady=(8, 0))

        warp = self.warp_box = box("Warp threads")
        wtrow = ttk.Frame(warp)
        wtrow.pack(anchor="w", pady=(0, 8))
        ttk.Radiobutton(wtrow, text="Inkle (pick-up)", variable=self.weave_var, value="inkle",
                        command=self._on_weave_type_change).pack(anchor="w")
        ttk.Radiobutton(wtrow, text="Tablet (cards)", variable=self.weave_var, value="tablet",
                        command=self._on_weave_type_change).pack(anchor="w")
        row = ttk.Frame(warp)
        row.pack(anchor="w")
        self.count_var = tk.StringVar(value="15")
        e = ttk.Entry(row, textvariable=self.count_var, width=6)
        e.pack(side="left")
        e.bind("<Return>", lambda _: self.generate())
        ttk.Button(row, text="Generate", style="Accent.TButton", command=self.generate).pack(side="left", padx=8)
        urow = ttk.Frame(warp)
        urow.pack(anchor="w", pady=(10, 0))
        self.undo_btn = ttk.Button(urow, text="↶ Undo", width=8, command=self.undo)
        self.undo_btn.pack(side="left")
        self.redo_btn = ttk.Button(urow, text="Redo ↷", width=8, command=self.redo)
        self.redo_btn.pack(side="left", padx=(6, 0))

        zoom_f = self.zoom_f = box("Preview zoom")
        zrow = ttk.Frame(zoom_f)
        zrow.pack(anchor="w")
        ttk.Button(zrow, text="-", width=3, command=lambda: self.zoom_by(-1)).pack(side="left")
        self._zoom_last = None
        self.zoom = ttk.Scale(zrow, from_=ZOOM_MIN, to=ZOOM_MAX, orient="horizontal", length=120,
                              command=lambda _v: self._on_zoom())
        self.zoom.set(ZOOM_DEFAULT)
        self.zoom.pack(side="left", padx=8)
        ttk.Button(zrow, text="+", width=3, command=lambda: self.zoom_by(1)).pack(side="left")
        self._rotate_var = tk.BooleanVar(value=False)
        self.rotate_check = ttk.Checkbutton(zoom_f, text="Rotate 90°", variable=self._rotate_var,
                                            command=self.toggle_rotate)
        self.rotate_check.pack(anchor="w", pady=(6, 0))

        tool_f = self.tool_f = box("Tool")
        self.mode = tk.StringVar(value="color")
        ttk.Radiobutton(tool_f, text="Color thread", variable=self.mode, value="color").pack(anchor="w", pady=2)
        ttk.Radiobutton(tool_f, text="Pick-up", variable=self.mode, value="pickup").pack(anchor="w", pady=2)
        ttk.Radiobutton(tool_f, text="Select repeat rows", variable=self.mode, value="range").pack(anchor="w", pady=2)
        hint(tool_f, "Shift+click = pick-up. Right-click\nerases (or resets range).")

        turn_f = self.turn_f = box("Turning sequence")
        ttk.Label(turn_f, text="Each row (block) holds a per-tablet\nF/B pattern for its repeat count.",
                 wraplength=210, justify="left").pack(anchor="w")
        self.turn_canvas = tk.Canvas(turn_f, height=CELL, highlightthickness=0, bg=CANVAS_BG)
        self.turn_hbar = ttk.Scrollbar(turn_f, orient="horizontal", command=self.turn_canvas.xview)
        self.turn_canvas.configure(xscrollcommand=self.turn_hbar.set)
        self.turn_canvas.pack(anchor="w", pady=(6, 0), fill="x")
        self.turn_hbar.pack(anchor="w", fill="x", pady=(0, 6))
        self.turn_canvas.bind("<Configure>", lambda e: self._draw_turn_blocks())
        self.turn_canvas.bind("<Button-1>", lambda e: self._on_turn_click(e, False, True))
        self.turn_canvas.bind("<B1-Motion>", lambda e: self._on_turn_click(e, False))
        self.turn_canvas.bind("<Button-3>", lambda e: self._on_turn_click(e, True, True))
        self.turn_canvas.bind("<B3-Motion>", lambda e: self._on_turn_click(e, True))
        brow = ttk.Frame(turn_f)
        brow.pack(anchor="w")
        ttk.Button(brow, text="+ Add block", command=self._add_turn_block).pack(side="left")
        ttk.Button(brow, text="Duplicate last", command=self._duplicate_turn_block).pack(side="left", padx=(6, 0))
        ttk.Label(turn_f, text="Selected block:", foreground=HINT).pack(anchor="w", pady=(8, 2))
        bulk1 = ttk.Frame(turn_f)
        bulk1.pack(anchor="w")
        ttk.Button(bulk1, text="All F", width=8, command=lambda: self._bulk_turn_block("f")).pack(side="left")
        ttk.Button(bulk1, text="All B", width=8, command=lambda: self._bulk_turn_block("b")
                  ).pack(side="left", padx=(4, 0))
        bulk2 = ttk.Frame(turn_f)
        bulk2.pack(anchor="w", pady=(4, 0))
        ttk.Button(bulk2, text="Evens → B", width=8, command=lambda: self._bulk_turn_block("evens")
                  ).pack(side="left")
        ttk.Button(bulk2, text="Odds → B", width=8, command=lambda: self._bulk_turn_block("odds")
                  ).pack(side="left", padx=(4, 0))
        hint(turn_f, "Click a tablet to toggle F/B, drag\nfor a range. Right-click (or drag)\nsets idle -- the card doesn't turn.\nShift+click flips S↔Z there (marked\nwith a pink corner). Click × to\ndelete a block, the repeat count\nto change it (right-click -1).")
        trow2 = ttk.Frame(turn_f)
        trow2.pack(anchor="w", pady=(8, 0))
        ttk.Label(trow2, text="Trace tablet #:").pack(side="left")
        self.trace_var = tk.StringVar(value="1")
        te = ttk.Entry(trow2, textvariable=self.trace_var, width=5)
        te.pack(side="left", padx=(4, 4))
        te.bind("<Return>", lambda _: self._open_trace_from_entry())
        ttk.Button(trow2, text="Go", width=4, command=self._open_trace_from_entry).pack(side="left")
        hint(turn_f, "Or click a tablet's number in the\nheader row above to trace it.")

        preset_f = self.preset_f = box("Preset colors")
        pw = SWATCH_COLS * (SWATCH + SWATCH_GAP)
        self.pal = tk.Canvas(preset_f, width=pw, height=1, highlightthickness=0, bg=self.cget("bg"))
        self.pal.pack(anchor="w")
        self.pal.bind("<Button-1>", lambda e: self._on_palette(e, False))
        self.pal.bind("<Button-3>", lambda e: self._on_palette(e, True))
        self._build_palette()
        ttk.Button(preset_f, text="Add current color", command=self.add_preset).pack(anchor="w", pady=(8, 0))
        hint(preset_f, "Right-click a swatch to replace it.")

        color_f = self.color_f = box("Custom color")
        self.sliders = {}
        self.slider_labels = {}
        for name in "RGB":
            r = ttk.Frame(color_f)
            r.pack(anchor="w", pady=1)
            ttk.Label(r, text=name, width=2).pack(side="left")
            s = ttk.Scale(r, from_=0, to=255, orient="horizontal", length=130, command=lambda _v: self.on_slider())
            s.pack(side="left", padx=4)
            lab = ttk.Label(r, width=4, anchor="e")
            lab.pack(side="left")
            self.sliders[name] = s
            self.slider_labels[name] = lab
        cur = ttk.Frame(color_f)
        cur.pack(anchor="w", pady=(8, 0))
        self.swatch = tk.Frame(cur, width=44, height=28, highlightthickness=1, highlightbackground=LINE)
        self.swatch.pack(side="left")
        self.hex_label = ttk.Label(cur, text="")
        self.hex_label.pack(side="left", padx=10)

        repeat_f = self.repeat_f = box("Repeat preview")
        rngrow = ttk.Frame(repeat_f)
        rngrow.pack(anchor="w")
        ttk.Label(rngrow, text="Rows").pack(side="left")
        self.range_start_var = tk.StringVar(value="0")
        self.range_end_var = tk.StringVar(value="0")
        e1 = ttk.Entry(rngrow, textvariable=self.range_start_var, width=5)
        e1.pack(side="left", padx=(6, 2))
        ttk.Label(rngrow, text="to").pack(side="left")
        e2 = ttk.Entry(rngrow, textvariable=self.range_end_var, width=5)
        e2.pack(side="left", padx=(2, 6))
        for e in (e1, e2):
            e.bind("<Return>", lambda _: self.apply_range_entries())
        ttk.Button(rngrow, text="Set", command=self.apply_range_entries).pack(side="left")
        ttk.Button(repeat_f, text="Use full range", command=self.select_full_range).pack(anchor="w", pady=(6, 6))
        rrow = ttk.Frame(repeat_f)
        rrow.pack(anchor="w")
        ttk.Label(rrow, text="Repeats").pack(side="left")
        self.repeat_var = tk.StringVar(value="4")
        re_ = ttk.Entry(rrow, textvariable=self.repeat_var, width=6)
        re_.pack(side="left", padx=(6, 8))
        re_.bind("<Return>", lambda _: self.open_repeat_preview())
        ttk.Button(rrow, text="Open", command=self.open_repeat_preview).pack(side="left")
        hint(repeat_f, "Dashed box in preview = selected rows.")

        self._tool_cols = 1
        self._arrange_tools(1)

    def grid_height(self):
        rows = len(TABLET_HOLES) + 1 if self.weave_var.get() == "tablet" else 2
        return PAD * 2 + rows * CELL

    def _on_weave_type_change(self, reset=True):
        """Switch the tool boxes, grid, and preview between Inkle pick-up and Tablet card weaving."""
        tablet = self.weave_var.get() == "tablet"
        self.warp_box.configure(text="Tablets" if tablet else "Warp threads")
        self.tool_f.grid_forget()
        self.repeat_f.grid_forget()
        self.turn_f.grid_forget()
        self.tool_boxes = [self.warp_box, self.zoom_f, self.preset_f, self.color_f]
        if tablet:
            self.tool_boxes.append(self.turn_f)
            self._rotate_var.set(False)
            self.rotated = False
            self.rotate_check.state(["disabled"])
        else:
            self.tool_boxes += [self.tool_f, self.repeat_f]
            self.rotate_check.state(["!disabled"])
        self._layout_preview_scrollbars()
        self.grid_canvas.configure(height=self.grid_height())
        self._tool_cols = None
        self._on_tools_configure()
        if reset:
            self.threads, self.pickups = [], set()
            self.tablet_colors, self.tablet_sz, self.turn_blocks = [], [], []
            self._active_turn_block = 0
            self._clear_history()
            self.count_var.set("15")
            self.path = None
            self.title("Inkle Pattern Generator")
            self.refresh()

    def _default_turn_blocks(self, n):
        return [{"pattern": ["F"] * n, "repeats": 4, "flips": [False] * n},
                {"pattern": ["B"] * n, "repeats": 4, "flips": [False] * n}]

    def _draw_turn_blocks(self):
        """Redraw the turning-sequence editor: a header of tablet numbers, then one row per block
        (repeat-count + delete control on the left, that block's per-tablet F/B/idle cells after)."""
        c = self.turn_canvas
        c.delete("all")
        n = len(self.tablet_colors)
        blocks = self.turn_blocks
        rows = len(blocks) + 1
        c.configure(height=rows * CELL)
        if not n or not blocks:
            c.configure(scrollregion=(0, 0, 1, 1))
            return
        content_w = TURN_LABEL_W + n * TURN_CELL_W
        c.configure(scrollregion=(0, 0, content_w, rows * CELL))
        for i in range(n):
            x = TURN_LABEL_W + (i + 0.5) * TURN_CELL_W
            c.create_text(x, CELL / 2, text=str(i + 1), font=("Segoe UI", 8))
        fills = {"F": "#C9A227", "B": "#5B6B8C", "I": CANVAS_BG}
        for bi, b in enumerate(blocks):
            y0 = (bi + 1) * CELL
            bg = "#E7EEF8" if bi == self._active_turn_block else CANVAS_BG
            c.create_rectangle(0, y0, content_w, y0 + CELL, fill=bg, outline="")
            c.create_text(14, y0 + CELL / 2, text="×", font=("Segoe UI", 10, "bold"), fill="#A33333")
            c.create_text(TURN_LABEL_W - 16, y0 + CELL / 2, text=f"{b['repeats']}×", font=("Segoe UI", 9))
            flips = b.get("flips", [False] * n)
            for i, state in enumerate(b["pattern"]):
                x0 = TURN_LABEL_W + i * TURN_CELL_W
                c.create_rectangle(x0 + 1, y0 + 2, x0 + TURN_CELL_W - 1, y0 + CELL - 2,
                                   fill=fills[state], outline=LINE)
                if state != "I":
                    c.create_text(x0 + TURN_CELL_W / 2, y0 + CELL / 2, text=state, fill="#FFFFFF",
                                  font=("Segoe UI", 8, "bold"))
                if i < len(flips) and flips[i]:  # flip marker: small triangle, top-right corner
                    c.create_polygon(x0 + TURN_CELL_W - 7, y0 + 2, x0 + TURN_CELL_W - 1, y0 + 2,
                                     x0 + TURN_CELL_W - 1, y0 + 8, fill="#E8699A", outline="")

    def _on_turn_click(self, event, erase, press=False):
        if not self.turn_blocks or not self.tablet_colors:
            return
        if press:
            self._stroke_saved = False
        x, y = self.turn_canvas.canvasx(event.x), event.y
        row = int(y // CELL)
        if row == 0:  # header row: click a tablet's number to trace it
            if press and x >= TURN_LABEL_W:
                n = len(self.tablet_colors)
                tablet = int((x - TURN_LABEL_W) // TURN_CELL_W)
                if 0 <= tablet < n:
                    self._open_tablet_trace(tablet)
            return
        block_idx = row - 1
        if not 0 <= block_idx < len(self.turn_blocks):
            return
        if x < TURN_LABEL_W:
            if press:
                self._on_turn_label_click(block_idx, x, erase)
            return
        n = len(self.tablet_colors)
        tablet = int((x - TURN_LABEL_W) // TURN_CELL_W)
        if not 0 <= tablet < n:
            return
        self._active_turn_block = block_idx
        block = self.turn_blocks[block_idx]
        if press:
            self._turn_shift_stroke = bool(event.state & 0x1)
        if self._turn_shift_stroke:
            # Shift+click toggles a flip; the whole stroke stays flip-only even if the mouse
            # drifts during the click (a bare B1-Motion carries no Shift bit of its own to check,
            # so without this the drift would silently fall through to painting F/B instead).
            if press:
                self._checkpoint()
                flips = block.setdefault("flips", [False] * n)
                flips[tablet] = not flips[tablet]
                self._draw_turn_blocks()
                self.redraw()
            return
        pattern = block["pattern"]
        if press:
            self._turn_drag_block = block_idx
            self._turn_drag_target = "F" if pattern[tablet] == "B" else "B"
        if self._turn_drag_block != block_idx:
            return
        new_state = "I" if erase else self._turn_drag_target
        if pattern[tablet] != new_state:
            self._checkpoint()
            pattern[tablet] = new_state
            self._draw_turn_blocks()
            self.redraw()

    def _on_turn_label_click(self, block_idx, x, erase):
        if x < 24:  # delete glyph
            if len(self.turn_blocks) > 1 and not erase:
                self._checkpoint()
                del self.turn_blocks[block_idx]
                self._active_turn_block = min(self._active_turn_block, len(self.turn_blocks) - 1)
                self._draw_turn_blocks()
                self.redraw()
            return
        self._checkpoint()  # repeat count: left-click +1, right-click -1
        b = self.turn_blocks[block_idx]
        b["repeats"] = max(1, min(999, b["repeats"] + (-1 if erase else 1)))
        self._active_turn_block = block_idx
        self._draw_turn_blocks()
        self.redraw()

    def _add_turn_block(self):
        n = len(self.tablet_colors)
        if not n:
            return
        self._push_undo()
        self.turn_blocks.append({"pattern": ["F"] * n, "repeats": 4, "flips": [False] * n})
        self._active_turn_block = len(self.turn_blocks) - 1
        self._draw_turn_blocks()
        self.redraw()

    def _duplicate_turn_block(self):
        if not self.turn_blocks:
            return
        self._push_undo()
        src = self.turn_blocks[-1]
        n = len(src["pattern"])
        self.turn_blocks.append({"pattern": list(src["pattern"]), "repeats": src["repeats"],
                                 "flips": list(src.get("flips", [False] * n))})
        self._active_turn_block = len(self.turn_blocks) - 1
        self._draw_turn_blocks()
        self.redraw()

    def _bulk_turn_block(self, kind):
        if not self.turn_blocks:
            return
        b = self.turn_blocks[self._active_turn_block]
        n = len(b["pattern"])
        self._push_undo()
        if kind == "f":
            b["pattern"] = ["F"] * n
        elif kind == "b":
            b["pattern"] = ["B"] * n
        elif kind == "evens":
            b["pattern"] = [("B" if (i + 1) % 2 == 0 else b["pattern"][i]) for i in range(n)]
        elif kind == "odds":
            b["pattern"] = [("B" if (i + 1) % 2 == 1 else b["pattern"][i]) for i in range(n)]
        self._draw_turn_blocks()
        self.redraw()

    def _open_trace_from_entry(self):
        try:
            tablet = int(self.trace_var.get()) - 1
            if not 0 <= tablet < len(self.tablet_colors):
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid input", f"Enter a tablet number between 1 and "
                                 f"{len(self.tablet_colors)}.")
            return
        self._open_tablet_trace(tablet)

    def _open_tablet_trace(self, tablet):
        if not self.tablet_colors:
            return
        TabletTraceWindow(self, tablet, self.tablet_colors[tablet], self.tablet_sz[tablet], self.turn_blocks)

    def select_full_range(self):
        self.set_range(0, max(self._visible_rows - 1, 0))

    def apply_range_entries(self):
        try:
            lo = int(self.range_start_var.get())
            hi = int(self.range_end_var.get())
        except ValueError:
            messagebox.showerror("Invalid input", "Row numbers must be whole numbers.")
            return
        self.set_range(lo, hi)

    def set_range(self, lo, hi):
        if lo > hi:
            lo, hi = hi, lo
        max_row = max(self._visible_rows - 1, 0)
        lo = max(0, min(lo, max_row))
        hi = max(lo, min(hi, max_row))
        self.range = (lo, hi)
        self.range_start_var.set(str(lo))
        self.range_end_var.set(str(hi))
        self.redraw()

    def open_repeat_preview(self):
        if not self.threads:
            messagebox.showinfo("Nothing to repeat", "Generate a pattern first.")
            return
        try:
            count = int(self.repeat_var.get())
            if not 1 <= count <= 200:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid input", "Enter a whole number of repeats between 1 and 200.")
            return
        lo, hi = self.range
        unit_pickups = {(i, r - lo) for i, r in self.pickups if lo <= r <= hi}
        RepeatWindow(self, list(self.threads), hi - lo + 1, unit_pickups, count, round(self.zoom.get()), self.rotated)

    def _on_zoom(self):
        z = round(self.zoom.get())
        if z != self._zoom_last:
            self._zoom_last = z
            self.redraw()

    def _build_palette(self):
        step = SWATCH + SWATCH_GAP
        rows = -(-len(self.presets) // SWATCH_COLS)
        self.pal.delete("all")
        self.pal.configure(height=rows * step)
        for i, c in enumerate(self.presets):
            x, y = (i % SWATCH_COLS) * step + 2, (i // SWATCH_COLS) * step + 2
            selected = c.upper() == self.color.upper()
            if selected:
                self.pal.create_rectangle(x - 2, y - 2, x + SWATCH + 1, y + SWATCH + 1, outline="#0067C0", width=2)
            self.pal.create_rectangle(x + 2, y + 2, x + SWATCH - 3, y + SWATCH - 3, fill=c, outline="#9AA0A6")

    def _on_palette(self, event, replace):
        step = SWATCH + SWATCH_GAP
        i = int(event.y // step) * SWATCH_COLS + int(event.x // step)
        if event.x < 0 or event.y < 0 or event.x // step >= SWATCH_COLS or not 0 <= i < len(self.presets):
            return
        if replace:
            self.replace_preset(i)
        else:
            self.set_color(self.presets[i])

    def add_preset(self):
        if self.color not in self.presets:
            self.presets.append(self.color)
            self._presets_changed()

    def replace_preset(self, i):
        if self.presets[i] != self.color:
            self.presets[i] = self.color
            self._presets_changed()

    def _presets_changed(self):
        self._build_palette()
        try:
            os.makedirs(os.path.dirname(PRESETS_FILE), exist_ok=True)
            with open(PRESETS_FILE, "w") as f:
                json.dump(self.presets, f)
        except OSError:
            pass

    def _load_presets(self):
        for path in (PRESETS_FILE, DEFAULT_PRESETS_FILE):
            if not path:
                continue
            try:
                with open(path) as f:
                    data = json.load(f)
                if isinstance(data, list) and data and all(isinstance(c, str) and HEX_RE.match(c) for c in data):
                    return [c.upper() for c in data]
            except (OSError, ValueError):
                pass
        return list(PRESETS)

    def _build_menu(self):
        m = tk.Menu(self)
        fm = tk.Menu(m, tearoff=0)
        fm.add_command(label="Open...", accelerator="Ctrl+O", command=self.open_file)
        fm.add_command(label="Save", accelerator="Ctrl+S", command=self.save_file)
        fm.add_command(label="Save As...", accelerator="Ctrl+Shift+S", command=lambda: self.save_file(True))
        m.add_cascade(label="File", menu=fm)
        self.edit_menu = em = tk.Menu(m, tearoff=0)
        em.add_command(label="Undo", accelerator="Ctrl+Z", command=self.undo)
        em.add_command(label="Redo", accelerator="Ctrl+Y", command=self.redo)
        m.add_cascade(label="Edit", menu=em)
        self.config(menu=m)
        self.bind("<Control-o>", lambda e: self.open_file())
        self.bind("<Control-s>", lambda e: self.save_file())
        self.bind("<Control-S>", lambda e: self.save_file(True))
        for key in ("z", "Z"):  # uppercase too, so Caps Lock doesn't break the shortcut
            self.bind(f"<Control-{key}>", lambda e: self.undo())
        for key in ("y", "Y"):
            self.bind(f"<Control-{key}>", lambda e: self.redo())

    def _snapshot(self):
        if self.weave_var.get() == "tablet":
            n = len(self.tablet_colors)
            return {"mode": "tablet", "tablet_colors": [list(c) for c in self.tablet_colors],
                    "tablet_sz": list(self.tablet_sz),
                    "turn_blocks": [{"pattern": list(b["pattern"]), "repeats": b["repeats"],
                                     "flips": list(b.get("flips", [False] * n))}
                                    for b in self.turn_blocks]}
        return {"mode": "inkle", "threads": list(self.threads), "pickups": set(self.pickups)}

    def _push_undo(self):
        """Record the current pattern so the next change can be undone; any redo history is discarded."""
        self._undo.append(self._snapshot())
        del self._undo[:-UNDO_LIMIT]
        self._redo.clear()
        self._update_undo_buttons()

    def _checkpoint(self):
        """Call just before modifying the pattern from a click/drag: pushes one undo entry per stroke."""
        if not self._stroke_saved:
            self._stroke_saved = True
            self._push_undo()

    def undo(self):
        if self._undo:
            self._redo.append(self._snapshot())
            self._restore(self._undo.pop())

    def redo(self):
        if self._redo:
            self._undo.append(self._snapshot())
            self._restore(self._redo.pop())

    def _restore(self, state):
        if state["mode"] == "tablet":
            self.tablet_colors = [list(c) for c in state["tablet_colors"]]
            self.tablet_sz = list(state["tablet_sz"])
            self.turn_blocks = [{"pattern": list(b["pattern"]), "repeats": b["repeats"],
                                 "flips": list(b.get("flips", [False] * len(b["pattern"])))}
                                for b in state["turn_blocks"]]
            self._active_turn_block = min(self._active_turn_block, len(self.turn_blocks) - 1)
            self.count_var.set(str(len(self.tablet_colors)))
            self._draw_turn_blocks()
        else:
            self.threads = list(state["threads"])
            self.pickups = set(state["pickups"])
            self.count_var.set(str(len(self.threads)))
        self._update_undo_buttons()
        self.refresh()

    def _clear_history(self):
        self._undo.clear()
        self._redo.clear()
        self._update_undo_buttons()

    def _update_undo_buttons(self):
        for btn, menu_idx, stack in ((self.undo_btn, 0, self._undo), (self.redo_btn, 1, self._redo)):
            btn.state(["!disabled"] if stack else ["disabled"])
            self.edit_menu.entryconfigure(menu_idx, state="normal" if stack else "disabled")

    def save_file(self, save_as=False):
        tablet = self.weave_var.get() == "tablet"
        if not (self.tablet_colors if tablet else self.threads):
            messagebox.showinfo("Nothing to save", "Generate a pattern first.")
            return
        path = self.path
        if save_as or not path:
            path = filedialog.asksaveasfilename(defaultextension=".inkl", initialfile=os.path.basename(self.path or ""),
                                                filetypes=[("Inkle pattern", "*.inkl")])
        if not path:
            return
        if tablet:
            data = {"version": 4, "mode": "tablet", "tablet_colors": self.tablet_colors,
                    "tablet_sz": self.tablet_sz, "turn_blocks": self.turn_blocks}
        else:
            data = {"version": 2, "mode": "inkle", "threads": self.threads, "pickups": sorted(self.pickups),
                    "range": list(self.range)}
        try:
            with open(path, "w") as f:
                json.dump(data, f, indent=1)
        except OSError as e:
            messagebox.showerror("Save failed", str(e))
            return
        self.path = path
        self.title(f"Inkle Pattern Generator - {os.path.basename(path)}")

    def open_file(self):
        path = filedialog.askopenfilename(filetypes=[("Inkle pattern", "*.inkl")])
        if not path:
            return
        try:
            with open(path) as f:
                data = json.load(f)
            mode = data.get("mode", "inkle")  # files from before tablet mode existed are all "inkle"
            if mode == "tablet":
                colors = data["tablet_colors"]
                if not (isinstance(colors, list) and 1 <= len(colors) <= 200 and all(
                        isinstance(c, list) and len(c) == 4 and
                        all(h is None or (isinstance(h, str) and HEX_RE.match(h)) for h in c) for c in colors)):
                    raise ValueError("invalid tablet threading")
                sz = data.get("tablet_sz", [False] * len(colors))
                if not (isinstance(sz, list) and len(sz) == len(colors)):
                    raise ValueError("invalid S/Z list")
                blocks_raw = data.get("turn_blocks")
                if blocks_raw is None:  # pre-individualized-turning files: a flat shared F/B unit
                    old_unit = data.get("turn_unit", [False] * 4 + [True] * 4)
                    blocks_raw = [{"pattern": [("B" if v else "F")] * len(colors), "repeats": 1}
                                  for v in old_unit]
                if not (isinstance(blocks_raw, list) and 1 <= len(blocks_raw) <= 200):
                    raise ValueError("invalid turning sequence")
                blocks = []
                for blk in blocks_raw:
                    pattern = blk["pattern"]
                    repeats = blk["repeats"]
                    if not (isinstance(pattern, list) and len(pattern) == len(colors) and
                            all(v in ("F", "B", "I") for v in pattern)):
                        raise ValueError("invalid turning block pattern")
                    if not (isinstance(repeats, int) and 1 <= repeats <= 999):
                        raise ValueError("invalid turning block repeat count")
                    flips = blk.get("flips", [False] * len(colors))  # v3 files predate flips
                    if not (isinstance(flips, list) and len(flips) == len(colors) and
                            all(isinstance(v, bool) for v in flips)):
                        raise ValueError("invalid turning block flips")
                    blocks.append({"pattern": list(pattern), "repeats": repeats, "flips": list(flips)})
            else:
                threads = data["threads"]
                if not (isinstance(threads, list) and 1 <= len(threads) <= 200 and
                        all(t is None or (isinstance(t, str) and HEX_RE.match(t)) for t in threads)):
                    raise ValueError("invalid thread list")
                pickups = {(int(i), int(r)) for i, r in data.get("pickups", [])}
                rng = data.get("range")
                rng = (int(rng[0]), int(rng[1])) if isinstance(rng, list) and len(rng) == 2 else None
        except (OSError, ValueError, KeyError, TypeError) as e:
            messagebox.showerror("Open failed", f"Could not read {os.path.basename(path)}: {e}")
            return
        self.weave_var.set(mode)
        self._on_weave_type_change(reset=False)
        if mode == "tablet":
            self.tablet_colors = [list(c) for c in colors]
            self.tablet_sz = [bool(v) for v in sz]
            self.turn_blocks = blocks
            self._active_turn_block = 0
            self.count_var.set(str(len(colors)))
            self._draw_turn_blocks()
        else:
            self.threads = threads
            self.pickups = {(i, r) for i, r in pickups if 0 <= i < len(threads)}
            self.count_var.set(str(len(threads)))
        self._clear_history()
        self.path = path
        self.title(f"Inkle Pattern Generator - {os.path.basename(path)}")
        self.refresh()
        if mode == "inkle":
            if rng:
                self.set_range(*rng)
            else:
                self.select_full_range()

    def set_color(self, hex_color):
        self.color = hex_color
        r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
        self._updating = True
        for name, v in zip("RGB", (r, g, b)):
            self.sliders[name].set(v)
        self._updating = False
        self._refresh_swatch()

    def on_slider(self):
        if getattr(self, "_updating", False):
            return
        self.color = "#%02X%02X%02X" % tuple(round(self.sliders[n].get()) for n in "RGB")
        self._refresh_swatch()

    def _refresh_swatch(self):
        self.swatch.config(bg=self.color)
        self.hex_label.config(text=self.color)
        for n in "RGB":
            self.slider_labels[n].config(text=str(round(self.sliders[n].get())))
        self._build_palette()  # moves the selection ring

    def generate(self):
        tablet = self.weave_var.get() == "tablet"
        try:
            n = int(self.count_var.get())
            if not 1 <= n <= 200:
                raise ValueError
        except ValueError:
            label = "tablets" if tablet else "threads"
            messagebox.showerror("Invalid input", f"Enter a whole number of {label} between 1 and 200.")
            return
        if (self.tablet_colors if tablet else self.threads):  # lets an accidental Generate be undone
            self._push_undo()
        if tablet:
            self.tablet_colors = [[None, None, None, None] for _ in range(n)]
            self.tablet_sz = [i % 2 == 1 for i in range(n)]
            self.turn_blocks = self._default_turn_blocks(n)
            self._active_turn_block = 0
        else:
            self.threads = [None] * n
            self.pickups = set()
        self.refresh()
        if not tablet:
            self.select_full_range()

    def zoom_by(self, d):
        self.zoom.set(min(ZOOM_MAX, max(ZOOM_MIN, round(self.zoom.get()) + d)))

    def hex_geometry(self, ph):
        hw = round(self.zoom.get())
        a, spacing = hex_dims(hw)
        rows = max(2, int((ph - a) // spacing))
        return hw, a, rows, spacing

    def redraw(self):
        if not hasattr(self, "canvas"):
            return
        if self.weave_var.get() == "tablet":
            self._redraw_tablet()
        else:
            self._redraw_inkle()

    def _redraw_tablet(self):
        c = self.canvas
        c.delete("all")
        n = len(self.tablet_colors)
        w, h = c.winfo_width(), c.winfo_height()
        if not n:
            c.configure(scrollregion=(0, 0, w, h))
            c.create_text(w / 2, h / 2, text="Enter the number of tablets and click Generate",
                          fill="#777777", font=("Segoe UI", 12))
            return
        x0, y0 = PAD + LABEL_W, PAD
        avail_h = max(h - y0 - PAD, 1)
        cell_w = round(self.zoom.get()) * 2
        cell_h = round(cell_w * 1.8)
        rows = max(4, avail_h // cell_h)
        self._visible_rows = rows
        extent = x0 + n * cell_w + PAD
        c.configure(scrollregion=(0, 0, max(extent, w), h))
        draw_tablet_band(c, self.tablet_colors, self.tablet_sz, self.turn_blocks, x0, y0, cell_w, cell_h, rows)

    def _redraw_inkle(self):
        c = self.canvas
        c.delete("all")
        n = len(self.threads)
        w, h = c.winfo_width(), c.winfo_height()
        if not n:
            c.configure(scrollregion=(0, 0, w, h))
            c.create_text(w / 2, h / 2, text="Enter the number of warp threads and click Generate",
                          fill="#777777", font=("Segoe UI", 12))
            return
        # unrotated: threads run across (x), rows run along (y, sized to window height)
        # rotated: threads run across (y), rows run along (x, sized to window width)
        across_origin = PAD if self.rotated else PAD + LABEL_W
        along_origin = PAD
        avail_along = max((w if self.rotated else h) - along_origin - PAD, 1)
        hw, a, rows, spacing = self.hex_geometry(avail_along)
        self._visible_rows = rows
        lo, hi = self.range
        max_row = max(rows - 1, 0)
        lo = max(0, min(lo, max_row))
        hi = max(lo, min(hi, max_row))
        self.range = (lo, hi)
        self.range_start_var.set(str(lo))
        self.range_end_var.set(str(hi))
        across_extent = across_origin + (n + 1) * hw + PAD
        if self.rotated:
            c.configure(scrollregion=(0, 0, w, max(across_extent, h)))
        else:
            c.configure(scrollregion=(0, 0, max(across_extent, w), h))
        # honeycomb preview: size set by zoom, row count set by available window space
        draw_honeycomb(c, self.threads, self.pickups, across_origin, along_origin, hw, a, spacing, rows,
                        rotated=self.rotated)
        # dashed box marking the rows selected as the repeat unit
        along_lo = along_origin + lo * spacing
        along_hi = along_origin + hi * spacing + (spacing + a)
        across_lo, across_hi = across_origin - hw, across_origin + (n + 1) * hw + hw
        if self.rotated:
            c.create_rectangle(along_lo, across_lo, along_hi, across_hi, outline="#0067C0", width=2, dash=(5, 3))
        else:
            c.create_rectangle(across_lo, along_lo, across_hi, along_hi, outline="#0067C0", width=2, dash=(5, 3))

    def grid_cell_width(self, n=None):
        """Width of one grid column: shrinks or grows so the whole grid always fits, no scrolling needed."""
        if n is None:
            n = len(self.tablet_colors) if self.weave_var.get() == "tablet" else len(self.threads)
        if not n or not hasattr(self, "grid_canvas"):
            return CELL
        avail = max(self.grid_canvas.winfo_width() - PAD - LABEL_W - PAD, 1)
        return min(GRID_CELL_MAX, max(GRID_CELL_MIN, avail / n))

    def draw_grid(self):
        """Redraw the threading grid on its own canvas, sized to fit the window width exactly."""
        if not hasattr(self, "grid_canvas"):
            return
        gc = self.grid_canvas
        gc.delete("all")
        w = max(gc.winfo_width(), 1)
        gc.configure(scrollregion=(0, 0, w, self.grid_height()))
        if self.weave_var.get() == "tablet":
            self._draw_tablet_grid()
        else:
            self._draw_inkle_grid()

    def _draw_inkle_grid(self):
        gc = self.grid_canvas
        n = len(self.threads)
        if not n:
            return
        gcell = self.grid_cell_width(n)
        x0 = PAD + LABEL_W
        for r, lab in enumerate("HU"):
            gc.create_text(PAD + LABEL_W / 2, PAD + r * CELL + CELL / 2, text=lab, font=("Segoe UI", 11, "bold"))
            for i in range(n):
                fill = (self.threads[i] or EMPTY) if i % 2 == r else EMPTY
                gc.create_rectangle(x0 + i * gcell, PAD + r * CELL, x0 + (i + 1) * gcell, PAD + (r + 1) * CELL,
                                    fill=fill, outline=LINE)

    def _draw_tablet_grid(self):
        """Four hole rows (A-D, paintable) plus an S/Z row (click to flip a tablet's threading)."""
        gc = self.grid_canvas
        n = len(self.tablet_colors)
        if not n:
            return
        gcell = self.grid_cell_width(n)
        x0 = PAD + LABEL_W
        for r, lab in enumerate(TABLET_HOLES):
            gc.create_text(PAD + LABEL_W / 2, PAD + r * CELL + CELL / 2, text=lab, font=("Segoe UI", 11, "bold"))
            for i in range(n):
                fill = self.tablet_colors[i][r] or EMPTY
                gc.create_rectangle(x0 + i * gcell, PAD + r * CELL, x0 + (i + 1) * gcell, PAD + (r + 1) * CELL,
                                    fill=fill, outline=LINE)
        sz_row = len(TABLET_HOLES)
        gc.create_text(PAD + LABEL_W / 2, PAD + sz_row * CELL + CELL / 2, text="S/Z", font=("Segoe UI", 9, "bold"))
        for i in range(n):
            is_z = self.tablet_sz[i]
            gc.create_rectangle(x0 + i * gcell, PAD + sz_row * CELL, x0 + (i + 1) * gcell, PAD + (sz_row + 1) * CELL,
                                fill=CANVAS_BG, outline=LINE)
            gc.create_text(x0 + (i + 0.5) * gcell, PAD + (sz_row + 0.5) * CELL, text=("Z" if is_z else "S"),
                          font=("Segoe UI", 9, "bold"), fill=("#6a7fb0" if is_z else "#b0756a"))

    def refresh(self):
        """Redraw the threading grid, the preview, and (in tablet mode) the turning-sequence editor --
        e.g. after thread/hole colors or tablet count change."""
        self.draw_grid()
        self.redraw()
        if self.weave_var.get() == "tablet" and hasattr(self, "turn_canvas"):
            self._draw_turn_blocks()

    def cell_at(self, x, y):
        """Return (thread, row) for a point in the preview, or None."""
        n = len(self.threads)
        across_origin = PAD if self.rotated else PAD + LABEL_W
        along_origin = PAD
        along_pos, across_pos = (x, y) if self.rotated else (y, x)
        if along_pos < along_origin:
            return None
        avail_along = max((self.canvas.winfo_width() if self.rotated else self.canvas.winfo_height())
                           - along_origin - PAD, 1)
        hw, a, rows, spacing = self.hex_geometry(avail_along)
        # pick-up bars sit on top of neighboring hexagons, so test them first
        for i, r in self.pickups:
            if r - 2 < 0 or r >= rows or i >= n or abs(across_pos - (across_origin + (i + 1) * hw)) > hw:
                continue
            near = along_origin + (r - 1) * spacing  # lower shoulder of the upper hexagon
            far = along_origin + r * spacing + a  # upper shoulder of the lower hexagon
            if near <= along_pos <= far:
                return i, r
        r0 = int((along_pos - along_origin) // spacing)
        for r in (r0, r0 - 1):
            if not 0 <= r < rows:
                continue
            for i in range(r % 2, n, 2):
                if abs(across_pos - (across_origin + (i + 1) * hw)) > hw:
                    continue
                poly = hex_poly(across_origin, hw, along_origin, a, spacing, r, i, self.rotated)
                signs = []
                for k in range(6):
                    (ax, ay), (bx, by) = poly[k], poly[(k + 1) % 6]
                    signs.append((bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0)
                if all(signs) or not any(signs):
                    return i, r
        return None

    def thread_at(self, x, y):
        """Return the thread index under a point in the preview, or None."""
        cell = self.cell_at(x, y)
        return cell[0] if cell else None

    def grid_thread_at(self, x, y):
        """Return the thread index under a point in the H/U grid, or None."""
        n = len(self.threads)
        if not n or not (PAD <= y < PAD + GRID_H):
            return None
        x0 = PAD + LABEL_W
        row = int((y - PAD) // CELL)
        i = int((x - x0) // self.grid_cell_width())
        return i if x >= x0 and 0 <= i < n and i % 2 == row else None

    def on_click(self, event, erase, press=False):
        if self.weave_var.get() == "tablet":
            return  # the tablet preview is read-only; edit threading and turning in the panels instead
        if not self.threads:
            return
        if press:
            self._stroke_saved = False
        x, y = self.canvas.canvasx(event.x), self.canvas.canvasy(event.y)
        mode = self.mode.get()
        if mode == "range":
            self._on_range_click(x, y, erase, press)
            return
        pickup_tool = mode == "pickup"
        if pickup_tool or (event.state & 0x1 and not erase):  # Shift+left click picks up in either tool
            self._on_pickup(x, y, erase, press)
            return
        i = self.thread_at(x, y)
        if i is None:
            return
        new = None if erase else self.color
        if self.threads[i] != new:
            self._checkpoint()
            self.threads[i] = new
            self.refresh()

    def on_grid_click(self, event, erase, press=False):
        if self.weave_var.get() == "tablet":
            self._on_tablet_grid_click(event, erase, press)
            return
        if not self.threads:
            return
        if press:
            self._stroke_saved = False
        # the H/U grid only colors threads; pick-up and row-select tools have no meaning here
        if self.mode.get() != "color" or (event.state & 0x1 and not erase):
            return
        i = self.grid_thread_at(self.grid_canvas.canvasx(event.x), event.y)
        if i is None:
            return
        new = None if erase else self.color
        if self.threads[i] != new:
            self._checkpoint()
            self.threads[i] = new
            self.refresh()

    def _on_tablet_grid_click(self, event, erase, press=False):
        if not self.tablet_colors:
            return
        if press:
            self._stroke_saved = False
        n = len(self.tablet_colors)
        x, y = self.grid_canvas.canvasx(event.x), event.y
        x0 = PAD + LABEL_W
        if x < x0 or y < PAD:
            return
        gcell = self.grid_cell_width(n)
        i = int((x - x0) // gcell)
        row = int((y - PAD) // CELL)
        if not 0 <= i < n or not 0 <= row <= len(TABLET_HOLES):
            return
        if row == len(TABLET_HOLES):  # S/Z row: a left-click press flips the tablet's threading
            if press and not erase:
                self._checkpoint()
                self.tablet_sz[i] = not self.tablet_sz[i]
                self.refresh()
            return
        new = None if erase else self.color
        if self.tablet_colors[i][row] != new:
            self._checkpoint()
            self.tablet_colors[i][row] = new
            self.refresh()

    def _on_range_click(self, x, y, erase, press):
        cell = self.cell_at(x, y)
        if cell is None:
            return
        if erase:  # right-click/drag resets to the full preview
            self.select_full_range()
            return
        _, row = cell
        if press or self._range_anchor is None:
            self._range_anchor = row
        self.set_range(self._range_anchor, row)

    def _on_pickup(self, x, y, erase, press):
        cell = self.cell_at(x, y)
        if cell is None or cell[1] < 2:  # rows 0-1 have no hexagon two rows above to reach
            return
        if press:  # a drag applies the state chosen by the first cell pressed
            self._pick_target = cell not in self.pickups
        want = False if erase else self._pick_target
        if (cell in self.pickups) != want:
            self._checkpoint()
            self.pickups.symmetric_difference_update({cell})
            self.redraw()


class RepeatWindow(tk.Toplevel):
    """Shows the unit pattern captured from the main preview, stacked `count` times, with its own zoom."""

    def __init__(self, master, threads, unit_rows, unit_pickups, count, zoom, rotated=False):
        super().__init__(master)
        self.title("Repeated preview")
        self.geometry("560x760")
        self.minsize(320, 300)
        self.threads = threads
        self.unit_rows = max(unit_rows, 1)
        self.unit_pickups = unit_pickups
        self.rotated = rotated
        self._zoom_last = None
        self._build_ui(count, zoom)
        self.redraw()

    def _build_ui(self, count, zoom):
        top = ttk.Frame(self, padding=10)
        top.pack(side="top", fill="x")
        ttk.Label(top, text="Repeats").pack(side="left")
        self.repeat_var = tk.StringVar(value=str(count))
        e = ttk.Entry(top, textvariable=self.repeat_var, width=6)
        e.pack(side="left", padx=(4, 12))
        e.bind("<Return>", lambda _: self.redraw())
        ttk.Button(top, text="Update", command=self.redraw).pack(side="left")
        ttk.Label(top, text="Zoom").pack(side="left", padx=(20, 0))
        ttk.Button(top, text="-", width=3, command=lambda: self.zoom_by(-1)).pack(side="left", padx=(6, 0))
        self.zoom = ttk.Scale(top, from_=ZOOM_MIN, to=ZOOM_MAX, orient="horizontal", length=120,
                              command=lambda _v: self._on_zoom())
        self.zoom.set(zoom)
        self.zoom.pack(side="left", padx=6)
        ttk.Button(top, text="+", width=3, command=lambda: self.zoom_by(1)).pack(side="left")
        self._rotate_var = tk.BooleanVar(value=self.rotated)
        ttk.Checkbutton(top, text="Rotate 90°", variable=self._rotate_var,
                        command=self._on_rotate_toggle).pack(side="left", padx=(20, 0))

        body = ttk.Frame(self)
        body.pack(side="top", fill="both", expand=True)
        self.canvas = tk.Canvas(body, bg=CANVAS_BG, highlightthickness=0)
        vbar = ttk.Scrollbar(body, orient="vertical", command=self.canvas.yview)
        hbar = ttk.Scrollbar(body, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vbar.set, xscrollcommand=hbar.set)
        vbar.pack(side="right", fill="y")
        hbar.pack(side="bottom", fill="x")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.canvas.bind("<Configure>", lambda e: self.redraw())
        self.canvas.bind("<Control-MouseWheel>", lambda e: self.zoom_by(1 if e.delta > 0 else -1))

    def zoom_by(self, d):
        self.zoom.set(min(ZOOM_MAX, max(ZOOM_MIN, round(self.zoom.get()) + d)))

    def _on_zoom(self):
        z = round(self.zoom.get())
        if z != self._zoom_last:
            self._zoom_last = z
            self.redraw()

    def _on_rotate_toggle(self):
        self.rotated = self._rotate_var.get()
        self.redraw()

    def redraw(self):
        if not hasattr(self, "canvas"):
            return
        c = self.canvas
        c.delete("all")
        n = len(self.threads)
        w, h = max(c.winfo_width(), 1), max(c.winfo_height(), 1)
        try:
            count = int(self.repeat_var.get())
            if not 1 <= count <= 200:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid input", "Enter a whole number of repeats between 1 and 200.")
            return
        if not n or not self.unit_rows:
            c.configure(scrollregion=(0, 0, w, h))
            return
        total_rows = self.unit_rows * count
        hw = round(self.zoom.get())
        a, spacing = hex_dims(hw)
        across_origin = along_origin = PAD
        across_extent = across_origin + (n + 1) * hw + PAD
        along_extent = along_origin + total_rows * spacing + a + PAD
        if self.rotated:
            c.configure(scrollregion=(0, 0, max(along_extent, w), max(across_extent, h)))
        else:
            c.configure(scrollregion=(0, 0, max(across_extent, w), max(along_extent, h)))
        pickups = {(i, r + rep * self.unit_rows) for rep in range(count) for i, r in self.unit_pickups}
        draw_honeycomb(c, self.threads, pickups, across_origin, along_origin, hw, a, spacing, total_rows,
                        rotated=self.rotated)


class TabletTraceWindow(tk.Toplevel):
    """Plain step-by-step trace of one tablet's turns, holes, and colors, as a table. For checking
    the hole-rotation rule by hand against a reference (a book, tutorial, or a physical sample) --
    much easier to verify a handful of picks on one tablet than to eyeball a whole rendered band
    against a photo. Uses the same tablet_hole_trace() the real preview draws from, so if this
    table is right, the band is right too (and if it's wrong, the bug is isolated to one function)."""

    ROWS = 32

    def __init__(self, master, tablet, colors, is_z, turn_blocks):
        super().__init__(master)
        self.title(f"Tablet {tablet + 1} trace")
        self.geometry("320x520")
        self.minsize(280, 300)
        top = ttk.Frame(self, padding=10)
        top.pack(side="top", fill="x")
        ttk.Label(top, text=f"Tablet {tablet + 1} — {'Z' if is_z else 'S'}-threaded, "
                             f"home = hole A", font=("Segoe UI", 10, "bold"), wraplength=280
                 ).pack(anchor="w")

        cols = ("pick", "turn", "hole", "color", "sz")
        tree = ttk.Treeview(self, columns=cols, show="headings", height=self.ROWS)
        widths = {"pick": 40, "turn": 40, "hole": 40, "color": 90, "sz": 36}
        for c in cols:
            tree.heading(c, text="S/Z" if c == "sz" else c.capitalize())
            tree.column(c, width=widths[c], anchor="center")
        vbar = ttk.Scrollbar(self, orient="vertical", command=tree.yview)
        tree.configure(yscrollcommand=vbar.set)
        vbar.pack(side="right", fill="y")
        tree.pack(side="top", fill="both", expand=True, padx=10, pady=(0, 10))

        for pick, state, idx, is_z_now in tablet_hole_trace(turn_blocks, tablet, self.ROWS, is_z):
            color = colors[idx] or EMPTY
            tag = f"p{pick}"
            sz_label = "Z" if is_z_now else "S"
            tree.insert("", "end", values=(pick, state, TABLET_HOLES[idx], color, sz_label), tags=(tag,))
            r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
            fg = "#000000" if (0.299 * r + 0.587 * g + 0.114 * b) > 140 else "#FFFFFF"
            tree.tag_configure(tag, background=color, foreground=fg)


if __name__ == "__main__":
    InkleApp().mainloop()
