@echo off
REM Creates (or updates) the "inkle" conda environment, then launches the app.
call conda env create -f environment.yml 2>nul || call conda env update -f environment.yml --prune
if errorlevel 1 (
    echo Failed to set up the environment. Is miniconda installed and on PATH?
    exit /b 1
)
call conda activate inkle
python inkle.py
