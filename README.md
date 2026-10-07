# Inkle Pattern Generator

A tool for designing inkle weaving patterns: warp-faced bands such as belts, straps and trim. Set up and color the warp threads on an H/U warping grid, add pick-up threads, see the woven band as a honeycomb preview, and preview a section repeated along the length of the band.

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

## Build the exe

With PyInstaller installed in the `inkle` env (`conda install -n inkle pyinstaller`), run `build.bat`. The result is `dist\InklePatterns.exe`, with `README.txt` copied next to it.
