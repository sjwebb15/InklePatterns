"""Inkle weaving pattern generator."""
import json
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


class InkleApp(tk.Tk):
    def __init__(self):
        super().__init__()
        sv_ttk.set_theme("light")
        self.title("Inkle Pattern Generator")
        self.geometry("1100x800")
        self.minsize(760, 560)
        self.threads = []  # color hex or None per thread
        self.pickups = set()  # (thread, row): hexagon at that row is joined to the next one in its column
        self._pick_target = True
        self.range = (0, 0)  # (first row, last row) of the preview used as the repeat unit
        self._visible_rows = 1  # rows currently drawn in the preview, at the current zoom/window size
        self._range_anchor = None
        self.rotated = False  # rotate the preview 90 deg: rows run left-to-right, threads run top-to-bottom
        self.path = None  # current .inkl file
        # undo/redo history of (threads, pickups) snapshots; one entry per click/drag stroke or Generate
        self._undo = []
        self._redo = []
        self._stroke_saved = False  # whether the current stroke has already pushed its undo snapshot
        self.presets = self._load_presets()
        self.color = "#DC143C"
        self._build_menu()
        # H/U grid: full window width, at the very top; cell width scales to fit so all threads stay visible
        self.grid_canvas = tk.Canvas(self, bg=CANVAS_BG, height=PAD * 2 + GRID_H, highlightthickness=0)
        self.grid_canvas.pack(side="top", fill="x")
        self.grid_canvas.bind("<Configure>", lambda e: self.draw_grid())
        self.grid_canvas.bind("<Button-1>", lambda e: self.on_grid_click(e, False, True))
        self.grid_canvas.bind("<B1-Motion>", lambda e: self.on_grid_click(e, False))
        self.grid_canvas.bind("<Button-3>", lambda e: self.on_grid_click(e, True, True))
        self.grid_canvas.bind("<B3-Motion>", lambda e: self.on_grid_click(e, True))
        ttk.Separator(self, orient="horizontal").pack(side="top", fill="x")

        # below the grid: tools on the left, preview filling the rest, sharing the remaining height
        body = ttk.Frame(self)
        body.pack(side="top", fill="both", expand=True)
        tools_container = ttk.Frame(body)
        tools_container.pack(side="left", fill="y")
        self._build_controls(tools_container)
        tools_container.bind("<Configure>", self._on_tools_configure)
        ttk.Separator(body, orient="vertical").pack(side="left", fill="y")

        right = ttk.Frame(body)
        right.pack(side="left", fill="both", expand=True)
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

    def _on_tools_configure(self, event):
        """Reflow the tool boxes into 1-3 columns so they always fit the available height without scrolling."""
        avail_h = event.height
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
            f.grid(row=idx // cols, column=idx % cols, sticky="nw", padx=6, pady=6)

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

        warp = box("Warp threads")
        row = ttk.Frame(warp)
        row.pack(anchor="w")
        self.count_var = tk.StringVar(value="15")
        e = ttk.Entry(row, textvariable=self.count_var, width=6)
        e.pack(side="left")
        e.bind("<Return>", lambda _: self.generate())
        ttk.Button(row, text="Generate", style="Accent.TButton", command=self.generate).pack(side="left", padx=8)

        zoom_f = box("Preview zoom")
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
        ttk.Checkbutton(zoom_f, text="Rotate 90°", variable=self._rotate_var,
                        command=self.toggle_rotate).pack(anchor="w", pady=(6, 0))

        tool_f = box("Tool")
        self.mode = tk.StringVar(value="color")
        ttk.Radiobutton(tool_f, text="Color thread", variable=self.mode, value="color").pack(anchor="w", pady=2)
        ttk.Radiobutton(tool_f, text="Pick-up", variable=self.mode, value="pickup").pack(anchor="w", pady=2)
        ttk.Radiobutton(tool_f, text="Select repeat rows", variable=self.mode, value="range").pack(anchor="w", pady=2)
        urow = ttk.Frame(tool_f)
        urow.pack(anchor="w", pady=(8, 0))
        self.undo_btn = ttk.Button(urow, text="↶ Undo", width=8, command=self.undo)
        self.undo_btn.pack(side="left")
        self.redo_btn = ttk.Button(urow, text="Redo ↷", width=8, command=self.redo)
        self.redo_btn.pack(side="left", padx=(6, 0))
        hint(tool_f, "Shift+click = pick-up. Right-click\nerases (or resets range).")

        preset_f = box("Preset colors")
        pw = SWATCH_COLS * (SWATCH + SWATCH_GAP)
        self.pal = tk.Canvas(preset_f, width=pw, height=1, highlightthickness=0, bg=self.cget("bg"))
        self.pal.pack(anchor="w")
        self.pal.bind("<Button-1>", lambda e: self._on_palette(e, False))
        self.pal.bind("<Button-3>", lambda e: self._on_palette(e, True))
        self._build_palette()
        ttk.Button(preset_f, text="Add current color", command=self.add_preset).pack(anchor="w", pady=(8, 0))
        hint(preset_f, "Right-click a swatch to replace it.")

        color_f = box("Custom color")
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

        repeat_f = box("Repeat preview")
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

    def _push_undo(self):
        """Record the current pattern so the next change can be undone; any redo history is discarded."""
        self._undo.append((list(self.threads), set(self.pickups)))
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
            self._redo.append((list(self.threads), set(self.pickups)))
            self._restore(self._undo.pop())

    def redo(self):
        if self._redo:
            self._undo.append((list(self.threads), set(self.pickups)))
            self._restore(self._redo.pop())

    def _restore(self, state):
        self.threads, self.pickups = list(state[0]), set(state[1])
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
        if not self.threads:
            messagebox.showinfo("Nothing to save", "Generate a pattern first.")
            return
        path = self.path
        if save_as or not path:
            path = filedialog.asksaveasfilename(defaultextension=".inkl", initialfile=os.path.basename(self.path or ""),
                                                filetypes=[("Inkle pattern", "*.inkl")])
        if not path:
            return
        data = {"version": 1, "threads": self.threads, "pickups": sorted(self.pickups), "range": list(self.range)}
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
        self.threads = threads
        self.pickups = {(i, r) for i, r in pickups if 0 <= i < len(threads)}
        self.count_var.set(str(len(threads)))
        self._clear_history()
        self.path = path
        self.title(f"Inkle Pattern Generator - {os.path.basename(path)}")
        self.refresh()
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
        try:
            n = int(self.count_var.get())
            if not 1 <= n <= 200:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid input", "Enter a whole number of threads between 1 and 200.")
            return
        if self.threads:  # lets an accidental Generate be undone
            self._push_undo()
        self.threads = [None] * n
        self.pickups = set()
        self.refresh()
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

    def grid_cell_width(self):
        """Width of one H/U grid column: shrinks or grows so the whole grid always fits, no scrolling needed."""
        n = len(self.threads)
        if not n or not hasattr(self, "grid_canvas"):
            return CELL
        avail = max(self.grid_canvas.winfo_width() - PAD - LABEL_W - PAD, 1)
        return min(GRID_CELL_MAX, max(GRID_CELL_MIN, avail / n))

    def draw_grid(self):
        """Redraw the H/U grid on its own canvas, sized to fit the window width exactly."""
        if not hasattr(self, "grid_canvas"):
            return
        gc = self.grid_canvas
        gc.delete("all")
        w = max(gc.winfo_width(), 1)
        gc.configure(scrollregion=(0, 0, w, PAD * 2 + GRID_H))
        n = len(self.threads)
        if not n:
            return
        gcell = self.grid_cell_width()
        x0 = PAD + LABEL_W
        for r, lab in enumerate("HU"):
            gc.create_text(PAD + LABEL_W / 2, PAD + r * CELL + CELL / 2, text=lab, font=("Segoe UI", 11, "bold"))
            for i in range(n):
                fill = (self.threads[i] or EMPTY) if i % 2 == r else EMPTY
                gc.create_rectangle(x0 + i * gcell, PAD + r * CELL, x0 + (i + 1) * gcell, PAD + (r + 1) * CELL,
                                    fill=fill, outline=LINE)

    def refresh(self):
        """Redraw both the H/U grid and the honeycomb preview, e.g. after thread colors or count change."""
        self.draw_grid()
        self.redraw()

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
        if cell is None:
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


if __name__ == "__main__":
    InkleApp().mainloop()
