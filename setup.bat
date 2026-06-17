@echo off
setlocal enabledelayedexpansion
title OP ePaper Tool – Setup

echo ============================================================
echo  OP ePaper Tool – Einrichtung
echo ============================================================
echo.

:: Node.js pruefen – zuerst im PATH, dann an typischen Installationsorten
where node >nul 2>&1
if errorlevel 1 (
    :: Typische Installationspfade durchsuchen
    set "NODE_FOUND="
    for %%P in (
        "%ProgramFiles%\nodejs"
        "%ProgramFiles(x86)%\nodejs"
        "%LOCALAPPDATA%\Programs\nodejs"
        "%APPDATA%\nvm\current"
        "%LOCALAPPDATA%\nvm\current"
    ) do (
        if not defined NODE_FOUND (
            if exist "%%~P\node.exe" (
                set "NODE_FOUND=%%~P"
            )
        )
    )
    if defined NODE_FOUND (
        set "PATH=!NODE_FOUND!;!PATH!"
        echo [INFO] Node.js gefunden unter: !NODE_FOUND!
        echo        Zum PATH hinzugefuegt fuer diese Sitzung.
    ) else (
        echo [FEHLER] Node.js nicht gefunden.
        echo.
        echo Bitte installieren von: https://nodejs.org
        echo Empfohlen: LTS-Version, Option "Add to PATH" waehlen.
        echo.
        echo Falls bereits installiert, einmal neu anmelden oder
        echo eine neue Eingabeaufforderung oeffnen und erneut versuchen.
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% gefunden

:: npm-Pakete installieren
echo.
echo [1/3] Installiere npm-Pakete...
call npm install
if errorlevel 1 (
    echo [FEHLER] npm install fehlgeschlagen.
    pause
    exit /b 1
)
echo [OK] npm-Pakete installiert

:: Playwright Chromium installieren
echo.
echo [2/3] Installiere Playwright Chromium...
call npx playwright install chromium
if errorlevel 1 (
    echo [FEHLER] Playwright-Installation fehlgeschlagen.
    pause
    exit /b 1
)
echo [OK] Chromium installiert

:: Kurze Hinweise
echo.
echo [3/3] Naechster Schritt: Selektoren ermitteln
echo.
echo     Starte den Selektor-Recorder mit:
echo       npx playwright codegen https://epaper.op-online.de
echo.
echo     Logge dich ein, navigiere zur Dreieich-Seite und klicke
echo     den PDF-Download-Button. Den generierten Code dann in
echo     core\downloader.js bei den SEL_*-Konstanten eintragen.
echo.
echo ============================================================
echo  Setup abgeschlossen. Starte die App mit:  start.bat
echo ============================================================
echo.
pause
