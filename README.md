# Inkle Pattern Generator

A tool for designing inkle weaving patterns: warp-faced bands such as belts, straps and trim. Set up and color the warp threads on an H/U warping grid, add pick-up threads, see the woven band as a honeycomb preview, and preview a section repeated along the length of the band.

## Use it in your browser

**https://sjwebb15.github.io/InklePatterns/** runs in any modern browser, with nothing to install. It has the same features as the Windows app and uses the same `.inkl` pattern files.

## Download (Windows)

Get `InklePatterns.exe` from the [latest release](../../releases/latest). It is a single file, so nothing needs to be installed. Windows may warn that the app is from an unknown publisher, because it isn't code-signed: click **More info**, then **Run anyway**.

[README.txt](README.txt) is the full user manual, covering every control. Each release includes a copy.

## Run from source

Requires [Miniconda](https://docs.anaconda.com/miniconda/) or Anaconda.

```
conda env create -f environment.yml
conda activate inkle
python inkle.py
```

On Windows, `setup.bat` does the same thing, and `run.bat` launches the app afterwards.

## Web version

The web version is plain HTML, CSS and JavaScript in [`web/`](web/), with no build step. Open `web/index.html` directly in a browser to run it locally. Every push to `main` that changes `web/` deploys it to GitHub Pages through [`.github/workflows/pages.yml`](.github/workflows/pages.yml). `web/app.js` is a port of `inkle.py`, so changes to one usually need the same change in the other.

## Build the exe

With PyInstaller installed in the `inkle` env (`conda install -n inkle pyinstaller`), run `build.bat`. The result is `dist\InklePatterns.exe`, with `README.txt` copied next to it.
