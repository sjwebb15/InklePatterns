@echo off
REM Launches the Inkle Pattern Generator using the "inkle" conda env (no console window).
REM Checks the common per-machine locations for the env; edit/add a line below if yours lives elsewhere.
set "PYW=%USERPROFILE%\.conda\envs\inkle\pythonw.exe"
if not exist "%PYW%" set "PYW=%LOCALAPPDATA%\miniconda3\envs\inkle\pythonw.exe"
if not exist "%PYW%" set "PYW=C:\ProgramData\miniconda3\envs\inkle\pythonw.exe"
if not exist "%PYW%" (
    echo Could not find the "inkle" conda environment in any known location.
    echo Run setup.bat first to create it.
    pause
    exit /b 1
)
start "" "%PYW%" "%~dp0inkle.py"
