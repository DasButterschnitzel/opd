@echo off
setlocal enabledelayedexpansion
title OP ePaper Tool - Dependency Installer
chcp 65001 >nul 2>&1

echo ============================================================
echo  OP ePaper Tool - Automatische Einrichtung
echo ============================================================
echo.

:: ============================================================
:: 1) NODE.JS
:: ============================================================
echo [1/3] Pruefe Node.js...

:: Direkt im PATH?
where node >nul 2>&1
if not errorlevel 1 goto :node_ok

:: Per Registry suchen (deckt alle Standard-Installer ab)
for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\nodejs" /v InstallPath 2^>nul') do set "NODE_PATH=%%B"
if not defined NODE_PATH (
    for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\WOW6432Node\nodejs" /v InstallPath 2^>nul') do set "NODE_PATH=%%B"
)
if not defined NODE_PATH (
    for /f "tokens=2*" %%A in ('reg query "HKCU\SOFTWARE\nodejs" /v InstallPath 2^>nul') do set "NODE_PATH=%%B"
)

:: Bekannte Pfade manuell pruefen
if not defined NODE_PATH (
    for %%P in (
        "%ProgramFiles%\nodejs"
        "%ProgramFiles(x86)%\nodejs"
        "%LOCALAPPDATA%\Programs\nodejs"
        "%APPDATA%\nvm\current"
        "%LOCALAPPDATA%\nvm\current"
        "%LOCALAPPDATA%\fnm\aliases\default"
    ) do (
        if not defined NODE_PATH (
            if exist "%%~P\node.exe" set "NODE_PATH=%%~P"
        )
    )
)

:: Per PowerShell im gesamten PATH suchen (breiteste Suche)
if not defined NODE_PATH (
    for /f "usebackq tokens=*" %%P in (`powershell -NoProfile -Command "(Get-Command node -ErrorAction SilentlyContinue).Source"`) do (
        if not "%%P"=="" (
            for %%F in ("%%P") do set "NODE_PATH=%%~dpF"
        )
    )
)

if defined NODE_PATH (
    set "PATH=!NODE_PATH!;!PATH!"
    echo    Gefunden unter: !NODE_PATH!
    where node >nul 2>&1
    if errorlevel 1 (
        echo    [WARN] Pfad gefunden aber node.exe nicht ausfuehrbar - fahre mit Download fort.
        goto :node_install
    )
    goto :node_ok
)

:node_install
echo    Node.js nicht gefunden - installiere automatisch...
echo.

:: winget versuchen (Windows 10 1709+, meistens vorhanden)
where winget >nul 2>&1
if not errorlevel 1 (
    echo    Installiere via winget (OpenJS.NodeJS.LTS)...
    winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    if not errorlevel 1 (
        :: PATH neu einlesen
        for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\nodejs" /v InstallPath 2^>nul') do set "NODE_PATH=%%B"
        if defined NODE_PATH set "PATH=!NODE_PATH!;!PATH!"
        where node >nul 2>&1
        if not errorlevel 1 goto :node_ok
    )
    echo    winget-Installation fehlgeschlagen, versuche manuellen Download...
)

:: Fallback: Node.js LTS direkt herunterladen und installieren
echo    Lade Node.js LTS Installer herunter...
set "NODE_INSTALLER=%TEMP%\node-lts-installer.msi"
powershell -NoProfile -Command ^
    "$url = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts } | Select-Object -First 1 | ForEach-Object { 'https://nodejs.org/dist/' + $_.version + '/node-' + $_.version + '-x64.msi' }); Invoke-WebRequest -Uri $url -OutFile '%NODE_INSTALLER%' -UseBasicParsing"
if not exist "%NODE_INSTALLER%" (
    echo.
    echo [FEHLER] Node.js konnte nicht automatisch heruntergeladen werden.
    echo.
    echo Bitte manuell installieren:
    echo   https://nodejs.org  ->  LTS herunterladen  ->  "Add to PATH" aktivieren
    echo   Danach dieses Skript erneut starten.
    echo.
    pause
    exit /b 1
)
echo    Fuehre Installer aus (bitte UAC bestaetigen)...
msiexec /i "%NODE_INSTALLER%" /quiet /norestart ADDLOCAL=ALL
del "%NODE_INSTALLER%" >nul 2>&1
:: PATH aktualisieren
for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\nodejs" /v InstallPath 2^>nul') do set "NODE_PATH=%%B"
if defined NODE_PATH set "PATH=!NODE_PATH!;!PATH!"
where node >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Installation abgeschlossen, aber node.exe immer noch nicht erreichbar.
    echo Bitte Eingabeaufforderung schliessen, neu oeffnen und nochmal versuchen.
    pause
    exit /b 1
)

:node_ok
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

:: ============================================================
:: 2) NPM-PAKETE (electron, playwright-core, electron-builder)
:: ============================================================
echo.
echo [2/3] Pruefe npm-Pakete...
if not exist "node_modules\electron" (
    echo    Installiere npm-Pakete (dauert einen Moment)...
    call npm install
    if errorlevel 1 (
        echo [FEHLER] npm install fehlgeschlagen.
        pause
        exit /b 1
    )
    echo [OK] npm-Pakete installiert
) else (
    echo [OK] node_modules bereits vorhanden
)

:: ============================================================
:: 3) PLAYWRIGHT CHROMIUM
:: ============================================================
echo.
echo [3/3] Pruefe Playwright Chromium...

:: Playwright gibt seinen Browser-Pfad per CLI aus
set "CHROMIUM_OK="
for /f "usebackq tokens=*" %%L in (`npx playwright install --dry-run chromium 2^>^&1`) do (
    echo %%L | findstr /i "already installed" >nul 2>&1
    if not errorlevel 1 set "CHROMIUM_OK=1"
)

if not defined CHROMIUM_OK (
    :: Auch per Pfad pruefen
    for /f "usebackq tokens=*" %%P in (`powershell -NoProfile -Command "$p = [System.IO.Path]::Combine($env:LOCALAPPDATA,'ms-playwright'); if(Test-Path $p){(Get-ChildItem $p -Filter 'chrome*' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).FullName}"`) do (
        if not "%%P"=="" set "CHROMIUM_OK=1"
    )
)

if not defined CHROMIUM_OK (
    echo    Installiere Playwright Chromium...
    call npx playwright install chromium
    if errorlevel 1 (
        echo [FEHLER] Chromium-Installation fehlgeschlagen.
        pause
        exit /b 1
    )
    echo [OK] Chromium installiert
) else (
    echo [OK] Chromium bereits installiert
)

:: ============================================================
:: FERTIG
:: ============================================================
echo.
echo ============================================================
echo  Alle Abhaengigkeiten bereit!
echo.
echo  Naechster Schritt: Selektoren ermitteln
echo    codegen.bat  starten, einloggen, Klickweg aufnehmen
echo    Ergebnis in core\downloader.js eintragen
echo.
echo  Dann App starten:
echo    start.bat
echo ============================================================
echo.
pause
