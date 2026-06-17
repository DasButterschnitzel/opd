@echo off
setlocal enabledelayedexpansion
title Playwright Selektor-Recorder
chcp 65001 >nul 2>&1

cd /d "%~dp0"

:: Node.js in PATH aufnehmen falls noetig
where node >nul 2>&1
if errorlevel 1 (
    for %%P in (
        "%LOCALAPPDATA%\Programs\nodejs"
        "%ProgramFiles%\nodejs"
        "%ProgramFiles(x86)%\nodejs"
        "%APPDATA%\nvm\current"
        "%LOCALAPPDATA%\nvm\current"
        "%LOCALAPPDATA%\fnm\aliases\default"
    ) do (
        if exist "%%~P\node.exe" (
            set "PATH=%%~P;!PATH!"
            goto :node_found
        )
    )
    echo [FEHLER] Node.js nicht gefunden. Bitte zuerst install-deps.bat ausfuehren.
    pause
    exit /b 1
)
:node_found

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
