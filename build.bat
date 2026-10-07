@echo off
REM Builds dist\InklePatterns.exe (single file, no console) with PyInstaller from the "inkle" conda env.
REM Only the build machine's env has PyInstaller (conda install -n inkle pyinstaller); it's not in environment.yml.
REM Intermediate build files go to %TEMP% so they don't sync to Google Drive; only the exe lands in dist\.
set "PY=%USERPROFILE%\.conda\envs\inkle\python.exe"
if not exist "%PY%" (
    echo Could not find the "inkle" conda environment at %PY%.
    pause
    exit /b 1
)
REM Without activating the env, conda's DLLs (tcl86t/tk86t, etc.) aren't on PATH and PyInstaller can't bundle them.
for %%I in ("%PY%") do set "PATH=%%~dpILibrary\bin;%PATH%"
set "WORK=%TEMP%\InklePatterns-build"
cd /d "%~dp0"
"%PY%" -m PyInstaller --noconfirm --clean --onefile --windowed --name InklePatterns ^
    --add-data "%~dp0presets.json;." ^
    --collect-data sv_ttk ^
    --workpath "%WORK%" --specpath "%WORK%" --distpath "%~dp0dist" ^
    "%~dp0inkle.py"
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)
REM Ship the user manual alongside the exe; the project-root README.txt is the master copy.
copy /y "%~dp0README.txt" "%~dp0dist\README.txt" >nul
echo Built dist\InklePatterns.exe (with README.txt)
