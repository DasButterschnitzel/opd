@echo off
setlocal enabledelayedexpansion
title Playwright Selektor-Recorder

:: Node.js in PATH aufnehmen falls noetig
where node >nul 2>&1
if errorlevel 1 (
    for %%P in (
        "%ProgramFiles%\nodejs"
        "%ProgramFiles(x86)%\nodejs"
        "%LOCALAPPDATA%\Programs\nodejs"
        "%APPDATA%\nvm\current"
        "%LOCALAPPDATA%\nvm\current"
    ) do (
        if exist "%%~P\node.exe" set "PATH=%%~P;!PATH!"
    )
)

where node >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Node.js nicht gefunden. Bitte zuerst setup.bat ausfuehren.
    pause
    exit /b 1
)

echo Oeffne Browser fuer https://epaper.op-online.de ...
echo.
echo Klickweg aufnehmen:
echo   1. Einloggen
echo   2. Zur Dreieich-Ausgabe navigieren
echo   3. PDF-Download-Button klicken
echo   4. Generierten Code rechts kopieren
echo   5. In core\downloader.js bei SEL_* und DOWNLOAD_SELECTOR eintragen
echo.
npx playwright codegen https://epaper.op-online.de
pause
