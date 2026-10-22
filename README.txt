INKLE PATTERN GENERATOR
=======================

A tool for designing inkle weaving patterns: warp-faced bands such as belts,
straps and trim. You set up the warp threads, color them, add pick-up
threads, and see a preview of the woven band. You can also preview a section
of the pattern repeated down the length of the band.

It also designs tablet (card) woven bands: you thread the cards, set the
turning sequence, and see the band that results (section 13).

There are two versions, and they work the same way:
  - A Windows program (InklePatterns.exe).
  - A web version that runs in any modern browser, with nothing to install:
    https://sjwebb15.github.io/InklePatterns/
Pattern files (.inkl) made in one open in the other. This manual describes
both. Section 16 lists the few differences in the web version.


CONTENTS
--------
  1. Starting the program
  2. The main window
  3. Warp threads
  4. Coloring threads
  5. The H/U warping grid
  6. The pattern preview
  7. Pick-up threads
  8. Colors: presets and custom colors
  9. Zoom and rotation
 10. Repeat preview
 11. Undo and redo
 12. Saving and opening patterns
 13. Tablet (card) weaving
 14. Quick reference
 15. Things to be aware of
 16. The web version


1. STARTING THE PROGRAM
-----------------------
Web version: open https://sjwebb15.github.io/InklePatterns/ in your browser.

Windows program: double-click InklePatterns.exe. It is a single file, so nothing needs to be
installed. It may take a few seconds to open.

The first time you run it, Windows may show a blue "Windows protected your
PC" message, because the program is not code-signed. Click "More info" and
then "Run anyway". You will only be asked once for each copy.

(If you run the program from its source code instead, double-click run.bat.
If this is the first time on that computer, run setup.bat first.)


2. THE MAIN WINDOW
------------------
The window has three areas:

  - Top: the H/U warping grid, across the full width of the window.
  - Bottom left: the tool boxes (Warp threads, Preview zoom, Preset colors,
    Custom color, Tool, Repeat preview). They rearrange themselves into
    one, two or three columns to fit the window height, so you never need to
    scroll to reach a control.
  - Bottom right: the pattern preview, showing how the woven band will look.

You can resize the window freely. To give the tool boxes more or less room,
drag the divider between them and the preview. The File menu at the top
holds Open, Save and Save As.

This section and sections 3 to 10 describe inkle weaving. In tablet weaving
the grid, tool boxes and preview change; see section 13.


3. WARP THREADS
---------------
At the top of the "Warp threads" box, choose the type of weaving: "Inkle
(pick-up)" (the default) or "Tablet (cards)" (see section 13).

In the "Warp threads" box, type the number of warp threads (1 to 200) and
click Generate, or press Enter. A blank pattern appears with every thread
uncolored (white).

The leftmost thread is the first heddled thread. After that the threads
alternate: heddled, unheddled, heddled, unheddled, and so on.

Note: Generate starts a new, blank pattern. It clears all thread colors and
pick-ups in the current pattern. If you click it by accident, press Undo
(Ctrl+Z) to get your pattern back.


4. COLORING THREADS
-------------------
Make sure the Tool box is set to "Color thread" (the default).

  - Choose a color: click a preset swatch, or set a custom color (see
    section 8).
  - Left-click any hexagon in the preview to color its whole thread with the
    current color. Every hexagon of that thread changes, and so does its
    cell in the H/U grid.
  - Left-click and drag across the preview to color several threads in one
    stroke.
  - Right-click a thread to erase it back to white. Right-click and drag to
    erase several threads.

You can also color threads by clicking the H/U grid (see the next section).


5. THE H/U WARPING GRID
-----------------------
The grid at the top is your warping chart. It has two rows:

  H = heddled threads (the ones that pass through a heddle)
  U = unheddled threads (the ones that pass between heddles)

There is one column per warp thread, in order from left to right. Each
thread is either heddled or unheddled, so it is colored in only one of the
two rows. The other row stays white, which gives the grid its checkerboard
look.

  - The grid always stretches to fit the window width, so every thread is
    always visible without scrolling. With many threads the columns get
    narrow; with few threads they get wide.
  - When the Tool is "Color thread", left-click (or drag) a colored-row cell
    to color that thread, and right-click (or drag) to erase it. Clicks on
    the white cells do nothing.
  - The grid only shows thread colors. Pick-ups never appear in it: the grid
    is for warping the loom, and pick-ups are made while weaving.


6. THE PATTERN PREVIEW
----------------------
The preview shows the face of the woven band as a honeycomb of tall, narrow
hexagons. Each hexagon is a spot where a warp thread shows on the surface of
the band.

  - Each thread is one column of hexagons, running down the length of the
    band.
  - Heddled threads appear in alternate rows (row 0, 2, 4, ...), and
    unheddled threads appear in the rows in between, offset by half a
    hexagon. This matches how the two sheds alternate as you weave.
  - Rows are numbered from 0, starting at the top of the preview (or at the
    left edge when the preview is rotated). The Repeat preview box uses
    these numbers.
  - The preview always fills the window's height. A taller window shows
    more rows of the band; it does not make the hexagons bigger. To change
    hexagon size, use the zoom (section 9).
  - If there are too many threads to fit across the preview, use the
    scrollbar to see the rest.
  - A dashed blue box marks the rows currently selected for the repeat
    preview (section 10).


7. PICK-UP THREADS
------------------
A pick-up thread is a warp thread lifted by hand so that it floats over the
next row instead of going under it. In the preview, a picked-up thread shows
as one long hexagon. It stretches from the thread's spot two rows up down to
the row you clicked, and covers the row in between.

To add pick-ups:
  - Select "Pick-up" in the Tool box, then left-click a hexagon. Click it
    again to remove the pick-up.
  - Or, while in "Color thread" mode, hold Shift and left-click. This is a
    shortcut, so you don't have to switch tools.
  - Click and drag to add pick-ups along a stroke. The first hexagon you
    press sets what the drag does: if it had no pick-up, the drag adds them;
    if it already had one, the drag removes them.

To remove pick-ups:
  - In Pick-up mode, right-click a pick-up, or right-click and drag across
    several.

Notes:
  - The first two rows (rows 0 and 1) cannot hold a pick-up, because there
    is no row two above them to reach.
  - A pick-up takes its thread's color. If you recolor the thread, its
    pick-ups change color too.
  - Pick-ups do not change the H/U grid.


8. COLORS: PRESETS AND CUSTOM COLORS
------------------------------------
The "current color" is what left-clicking paints. It appears as a swatch and
a hex code (for example #DC143C) at the bottom of the Custom color box.

Preset colors box:
  - Left-click a swatch to make it the current color. The current color's
    swatch is outlined in blue.
  - "Add current color" adds the current color to the end of the palette
    (unless it's already there).
  - Right-click a swatch to replace it with the current color.
  - Your palette is saved automatically as soon as you change it, and it
    comes back the next time you start the program.
    (It is stored in %APPDATA%\InklePatterns\presets.json. Delete that file
    to go back to the original palette.)

Custom color box:
  - Drag the R (red), G (green) and B (blue) sliders, each 0 to 255, to mix
    any color. The number beside each slider shows its value.
  - Choosing a preset also moves the sliders to that color, so you can
    start from a preset and adjust it.
  - To keep a custom color for later, click "Add current color" in the
    Preset colors box, or right-click a swatch to replace it.


9. ZOOM AND ROTATION
--------------------
The "Preview zoom" box controls the size of the hexagons in the main
preview:

  - Drag the slider, or click - and + to go one step at a time.
  - Or hold Ctrl and turn the mouse wheel over the preview.

Zooming out shows more rows (a longer piece of the band). Zooming in shows
fewer, bigger hexagons. Zoom does not affect the H/U grid.

"Rotate 90°" turns the preview on its side so the band runs left to right
instead of top to bottom. This is useful for seeing a long stretch of band
on a wide screen.
  - When rotated, threads run across the preview from top to bottom, rows
    run left to right, and row 0 is at the left edge.
  - Painting, erasing, pick-ups and row selection all work the same way
    when rotated.
  - The H/U grid never rotates.


10. REPEAT PREVIEW
------------------
Most inkle patterns repeat a short section over and over. The repeat
preview shows how a chosen section looks when it is repeated many times.

Step 1: Choose the rows to repeat (the "repeat unit"). Use any of these:
  - Select "Select repeat rows" in the Tool box, then click and drag down
    the preview from the first row of the unit to the last. Right-click the
    preview to reset to all rows.
  - Or type the first and last row numbers into the "Rows ... to ..." fields
    in the Repeat preview box, and click Set (or press Enter). Rows are
    numbered from 0 at the top.
  - Or click "Use full range" to select every row currently shown in the
    preview.
  The dashed blue box on the preview shows your selection.

Step 2: Type the number of repeats (1 to 200) into "Repeats" and click Open
(or press Enter).

A separate "Repeated preview" window opens, showing the unit stacked end to
end that many times, including its pick-ups. In that window:
  - Change the Repeats number and click Update (or press Enter) to redraw.
  - Zoom with the slider, the - and + buttons, or Ctrl + mouse wheel. This
    zoom is separate from the main window's.
  - "Rotate 90°" turns the view on its side. It starts out matching the main
    preview, but after that it is separate.
  - Use the scrollbars to move around. The repeated band can be much longer
    than the window.
  - This window is for viewing only. You cannot paint or add pick-ups in it.

Tips:
  - The repeat window is a snapshot. If you change the pattern afterward,
    close it and click Open again to see the changes. You can have several
    repeat windows open at once, for example to compare versions.
  - A pick-up in the first two rows of the unit reaches up into the end of
    the previous repeat, just as it would on the loom.
  - You can only select rows that are currently visible in the preview. For
    a longer repeat unit, zoom out or make the window taller.


11. UNDO AND REDO
-----------------
  - Undo (Ctrl+Z) takes back your last change. Press it repeatedly to go
    further back, up to 500 steps.
  - Redo (Ctrl+Y) puts back a change you just undid.
  - You can use the Undo and Redo buttons in the Warp threads box, the Edit
    menu, or the keyboard shortcuts. A button is grayed out when there is
    nothing to undo or redo.

What counts as one step:
  - A single click, or a whole click-and-drag stroke, whether coloring,
    erasing, or adding/removing pick-ups. Undo removes the whole stroke at
    once.
  - Clicking Generate. Undo brings back the previous pattern and its thread
    count.
  - In tablet weaving: painting or erasing holes, switching a tablet between
    S and Z, and every change to the turning sequence (cells, repeat counts,
    adding or deleting blocks, flips, and the bulk buttons).

Not undone: palette changes, zoom, rotation, and the repeat-row selection.
These don't change the pattern itself.

Making a new change after undoing clears the redo history. Opening a file,
or switching between inkle and tablet weaving, clears all undo history.


12. SAVING AND OPENING PATTERNS
-------------------------------
Patterns are saved as .inkl files. Use the File menu:

  - Save (Ctrl+S): saves to the current file. If the pattern hasn't been
    saved yet, it asks for a file name.
  - Save As... (Ctrl+Shift+S): saves under a new name or location.
  - Open... (Ctrl+O): loads a saved pattern.

A saved inkle pattern includes the number of threads, every thread's color,
all pick-ups, and the selected repeat rows. A saved tablet pattern includes
the number of tablets, the color in every hole, each tablet's S/Z threading,
and the whole turning sequence, including flips. Opening a file switches to
the right type of weaving by itself. The current file's name appears in the
window title.

If a file is damaged or isn't an inkle pattern, the program shows an error
message and leaves your current pattern unchanged.


13. TABLET (CARD) WEAVING
-------------------------
In tablet weaving, each card (tablet) carries four threads, one through each
of its holes, labeled A, B, C and D. The color that shows on the band at each
pick depends on how far the card has been turned. So in this mode you don't
paint the preview. You set up the threading and the turning sequence, and
the program works out how the band will look.

Starting a tablet pattern
  - In the "Warp threads" box, choose "Tablet (cards)". The box is renamed
    "Tablets".
  - Type the number of tablets (1 to 200) and click Generate, or press
    Enter.
  - The new pattern has every hole white, the tablets threaded S, Z, S, Z...
    (tablet 1 is S), and a turning sequence of 4 picks forward then 4
    backward.
  - Switching between inkle and tablet weaving starts a new, blank pattern.
    Save your work first; the switch can't be undone.

In tablet mode, the Tool and Repeat preview boxes are hidden and a Turning
sequence box appears. Rotate 90° is not available.

The threading grid
The grid at the top has one column per tablet, tablet 1 at the left, and
five rows:
  - A, B, C, D: the thread color in each hole. Left-click (or drag) to
    paint holes with the current color. Right-click (or drag) to erase them
    to white.
  - S/Z: how the tablet is threaded. Click a tablet's S/Z cell to switch it
    between S and Z. This works one click at a time, not by dragging.

The turning sequence
The Turning sequence box holds the sequence as a list of blocks. Each block
is one row. It says, for every tablet, whether that tablet turns forward
(F), turns backward (B) or stays still (idle, shown blank), and how many
picks the block lasts. The blocks run from top to bottom, then the whole
sequence starts again from the top. The numbers across the top row are the
tablet numbers.

  - Left-click a cell to switch it between F and B. Drag along a row to set
    several cells. The first cell you press decides whether the drag makes
    them F or B.
  - Right-click (or right-drag) a cell to make it idle.
  - The number at the left of each row (for example "4×") is how many picks
    the block lasts. Left-click it to add one, right-click to take one away.
  - Click the red × at the left of a row to delete that block. The last
    remaining block can't be deleted.
  - "+ Add block" adds a block at the bottom: every tablet forward, 4
    picks.
  - "Duplicate last" adds a copy of the bottom block. A common way to build
    a sequence is to duplicate a block, then change a few tablets.
  - The block you clicked last is the selected block, shaded blue. The
    buttons under "Selected block" change it all at once: "All F", "All B",
    "Evens → B" (tablets 2, 4, 6... turn backward; others are unchanged)
    and "Odds → B" (tablets 1, 3, 5... turn backward; others unchanged).
  - If there are more tablets than fit, use the scrollbar under the grid, or
    drag the divider between the tool boxes and the preview to make the tool
    area wider.

Flipping cards
To turn a card over partway through, which swaps it between S and Z without
re-threading, hold Shift and click that tablet's cell in a block. The card
flips at the start of that block. A small pink triangle in the cell's corner
marks the flip; Shift+click again to remove it.
Because the sequence repeats, the flip happens every time that block comes
round. A card flipped in a repeating block flips back and forth each time
through the sequence.

The preview
  - Each row of the preview is one pick, with pick 1 at the top. Each
    tablet shows as a tilted oval in the color of the thread showing at that
    pick.
  - The tilt shows which way the twist leans. It depends on the tablet's
    S/Z threading and on whether it is turning forward or backward.
  - When a tablet changes direction, the same thread shows for two picks in
    a row, just as it does on the loom. An idle tablet looks the same as it
    did on the pick before.
  - The turning sequence repeats down the preview to fill the window, so
    there is no separate repeat preview in tablet mode.
  - The preview is for viewing only; clicking it does nothing. Zoom works
    the same as in inkle mode (section 9).

Tracing one tablet
To check a tablet pick by pick, for example against a chart or a woven
sample, click its number in the top row of the turning sequence, or type
the number into "Trace tablet #" and click Go (or press Enter). A small
window lists that tablet's first 32 picks: the turn (F, B or I for idle),
which hole is showing, its color, and whether the card is S or Z at that
pick. The trace is a snapshot: if you change the pattern, open it again.


14. QUICK REFERENCE
-------------------
Preview (Tool = Color thread)
  Left-click / drag ............ color thread(s) with the current color
  Right-click / drag ........... erase thread(s) to white
  Shift + left-click / drag .... add or remove pick-ups
  Ctrl + mouse wheel ........... zoom

Preview (Tool = Pick-up)
  Left-click / drag ............ add or remove pick-ups
  Right-click / drag ........... remove pick-ups

Preview (Tool = Select repeat rows)
  Left-click / drag ............ select the rows to repeat
  Right-click .................. reset the selection to all rows

H/U grid (Tool = Color thread only)
  Left-click / drag ............ color thread(s)
  Right-click / drag ........... erase thread(s)

Threading grid (tablet weaving)
  Left-click / drag on A-D ..... paint holes with the current color
  Right-click / drag on A-D .... erase holes
  Left-click on S/Z ............ switch the tablet between S and Z

Turning sequence (tablet weaving)
  Left-click / drag a cell ..... switch between F and B
  Right-click / drag a cell .... make idle
  Shift + left-click a cell .... flip the card at that block (or undo it)
  Left / right-click "4×" ...... one more / one fewer pick in the block
  Click × ...................... delete the block
  Click a tablet number ........ open that tablet's trace

Preset swatches
  Left-click ................... make it the current color
  Right-click .................. replace it with the current color

Keyboard
  Enter (in a number box) ...... same as that box's button
  Ctrl+Z / Ctrl+Y .............. Undo / Redo
  Ctrl+O / Ctrl+S / Ctrl+Shift+S  Open / Save / Save As


15. THINGS TO BE AWARE OF
-------------------------
  - The program does not warn about unsaved changes. Closing the window,
    opening another file, or switching between inkle and tablet weaving
    discards any unsaved work, and that can't be undone.
  - Generate always starts a blank pattern, even if the thread count hasn't
    changed. You can undo it with Ctrl+Z.


16. THE WEB VERSION
-------------------
The web version has the same controls as the Windows program, with these
differences:

Saving and opening
  - In Chrome and Edge, Save and Open work like a desktop program: you
    choose where the file goes, and Save updates the same file afterwards.
    The browser may ask once for permission to save changes to the file.
  - In other browsers (Firefox, Safari), Save downloads the pattern as a
    .inkl file, normally into your Downloads folder. Save As asks for a
    file name first.
  - You can also open a pattern by dragging a .inkl file onto the page.

Unsaved changes
  - Unlike the Windows program, the web version warns you if you try to
    close or reload the page with unsaved changes. It also asks before
    switching between inkle and tablet weaving if there are unsaved
    changes.

Preset colors
  - Your palette is saved in your browser, so it stays on that computer and
    browser. Clearing your browser's site data resets it.
  - The Reset button in the Preset colors box restores the original
    palette.

Repeat preview and tablet trace
  - Each opens as a panel on top of the page rather than a separate
    window. Close it with the Close button or the Esc key. Only one can be
    open at a time.

Tablets and touch screens
  - Tick "Eraser (left-click erases)" in the Warp threads box to erase with
    a tap or a plain click, since there's no right-click. In tablet
    weaving, Eraser also makes turning-sequence cells idle and takes one
    pick off a block's repeat count.
  - To remove a pick-up on a touch screen, tick Eraser while using the
    Pick-up tool.
  - To flip cards without a Shift key, tick "Flip mode" in the Turning
    sequence box: each click or tap then marks or removes a flip.
  - In the turning sequence, a tap changes one cell. Swipe to scroll a
    sequence that is wider than the box.

Small screens
  - In a narrow window (such as a phone), the tool boxes sit above the
    preview and the page scrolls.
