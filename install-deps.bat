@echo off
setlocal enabledelayedexpansion
title OP ePaper Tool - Dependency Installer
chcp 65001 >nul 2>&1

echo ============================================================
echo  OP ePaper Tool - Automatische Einrichtung (kein Admin noetig)
echo ============================================================
echo.

:: Node.js wird OHNE Adminrechte als ZIP ins Benutzerverzeichnis installiert.
:: Alle weiteren Pakete (npm, Playwright Chromium) benoetigen ebenfalls
:: keine erhoehten Rechte.

set "NODE_INSTALL_DIR=%LOCALAPPDATA%\Programs\nodejs"

:: ============================================================
:: 1) NODE.JS
:: ============================================================
echo [1/3] Pruefe Node.js...

:: Bereits im PATH?
where node >nul 2>&1
if not errorlevel 1 goto :node_ok

:: Bekannte benutzer-lokale Pfade pruefen
for %%P in (
    "%LOCALAPPDATA%\Programs\nodejs"
    "%APPDATA%\nvm\current"
    "%LOCALAPPDATA%\nvm\current"
    "%LOCALAPPDATA%\fnm\aliases\default"
    "%USERPROFILE%\nodejs"
    "%USERPROFILE%\.node"
) do (
    if not defined NODE_PATH (
        if exist "%%~P\node.exe" set "NODE_PATH=%%~P"
    )
)

:: HKCU-Registry (Benutzer-Installer oder nvm)
if not defined NODE_PATH (
    for /f "tokens=2*" %%A in ('reg query "HKCU\SOFTWARE\nodejs" /v InstallPath 2^>nul') do set "NODE_PATH=%%B"
)

if defined NODE_PATH (
    set "PATH=!NODE_PATH!;!PATH!"
    echo    Gefunden unter: !NODE_PATH!
    where node >nul 2>&1
    if not errorlevel 1 goto :node_ok
    set "NODE_PATH="
)

:: Node.js nicht gefunden -> als ZIP ohne Admin installieren
:node_install_zip
echo    Node.js nicht gefunden.
echo    Lade Node.js LTS als ZIP herunter (kein Admin noetig)...
echo.

set "NODE_ZIP=%TEMP%\node-lts-win.zip"
set "NODE_EXTRACT=%TEMP%\node-lts-extract"

:: Aktuelle LTS-Version und ZIP-URL ermitteln
for /f "usebackq tokens=*" %%V in (`powershell -NoProfile -Command ^
    "try { $r = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing; $lts = $r | Where-Object { $_.lts } | Select-Object -First 1; Write-Output $lts.version } catch { Write-Output 'ERROR' }"`) do set "NODE_VER_DL=%%V"

if "!NODE_VER_DL!"=="ERROR" (
    goto :node_dl_fail
)
if "!NODE_VER_DL!"=="" goto :node_dl_fail

echo    Version: !NODE_VER_DL!
set "NODE_ZIP_URL=https://nodejs.org/dist/!NODE_VER_DL!/node-!NODE_VER_DL!-win-x64.zip"
set "NODE_DIR_NAME=node-!NODE_VER_DL!-win-x64"

:: ZIP herunterladen
powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '!NODE_ZIP_URL!' -OutFile '!NODE_ZIP!' -UseBasicParsing"

if not exist "!NODE_ZIP!" goto :node_dl_fail

:: Entpacken
echo    Entpacke nach %NODE_INSTALL_DIR%...
if exist "!NODE_EXTRACT!" rmdir /s /q "!NODE_EXTRACT!"
powershell -NoProfile -Command ^
    "Expand-Archive -Path '!NODE_ZIP!' -DestinationPath '!NODE_EXTRACT!' -Force"
del "!NODE_ZIP!" >nul 2>&1

if not exist "!NODE_EXTRACT!\!NODE_DIR_NAME!\node.exe" goto :node_dl_fail

:: An Zielort verschieben
if exist "%NODE_INSTALL_DIR%" rmdir /s /q "%NODE_INSTALL_DIR%"
move "!NODE_EXTRACT!\!NODE_DIR_NAME!" "%NODE_INSTALL_DIR%" >nul
rmdir "!NODE_EXTRACT!" >nul 2>&1

:: Benutzer-PATH dauerhaft setzen (HKCU, kein Admin)
powershell -NoProfile -Command ^
    "$regPath = 'HKCU:\Environment'; $cur = (Get-ItemProperty $regPath -Name Path -ErrorAction SilentlyContinue).Path; if ($cur -notlike '*nodejs*') { $new = '%NODE_INSTALL_DIR%' + ';' + $cur; Set-ItemProperty $regPath -Name Path -Value $new -Type ExpandString; Write-Output 'PATH aktualisiert.' }"

set "NODE_PATH=%NODE_INSTALL_DIR%"
set "PATH=%NODE_INSTALL_DIR%;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [FEHLER] Node.js wurde entpackt, ist aber nicht ausfuehrbar.
    echo Pfad: %NODE_INSTALL_DIR%
    pause
    exit /b 1
)
echo    Node.js als ZIP installiert unter: %NODE_INSTALL_DIR%
goto :node_ok

:node_dl_fail
echo.
echo [FEHLER] Automatischer Download fehlgeschlagen (kein Internetzugang?).
echo.
echo Manuelle Alternative (kein Admin noetig):
echo   1. https://nodejs.org  ->  LTS  ->  "Windows Binary (.zip)"  herunterladen
echo   2. ZIP entpacken nach:  %NODE_INSTALL_DIR%
echo      (so dass dort node.exe liegt)
echo   3. Dieses Skript erneut starten.
echo.
pause
exit /b 1

:node_ok
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
for /f "tokens=*" %%v in ('npm --version') do set NPM_VER=%%v
echo [OK] Node.js %NODE_VER%  /  npm %NPM_VER%

:: ============================================================
:: 2) NPM-PAKETE
:: ============================================================
echo.
echo [2/3] Pruefe npm-Pakete...

if not exist "%~dp0node_modules\electron\package.json" (
    echo    Installiere npm-Pakete (dauert 1-2 Minuten)...
    pushd "%~dp0"
    call npm install
    if errorlevel 1 (
        echo [FEHLER] npm install fehlgeschlagen.
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] npm-Pakete installiert
) else (
    echo [OK] node_modules bereits vorhanden
)

:: ============================================================
:: 3) PLAYWRIGHT CHROMIUM
:: ============================================================
echo.
echo [3/3] Pruefe Playwright Chromium...

:: Pruefen ob Chromium-Verzeichnis schon existiert
set "CHROMIUM_OK="
for /f "usebackq tokens=*" %%P in (`powershell -NoProfile -Command ^
    "$p = Join-Path $env:LOCALAPPDATA 'ms-playwright'; if (Test-Path $p) { $d = Get-ChildItem $p -Directory -Filter 'chromium*' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($d) { $d.FullName } }"`) do (
    if not "%%P"=="" set "CHROMIUM_OK=1"
)

if not defined CHROMIUM_OK (
    echo    Installiere Playwright Chromium (ca. 150 MB)...
    pushd "%~dp0"
    call npx playwright install chromium
    if errorlevel 1 (
        echo [FEHLER] Chromium-Installation fehlgeschlagen.
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] Chromium installiert
) else (
    echo [OK] Chromium bereits vorhanden
)

:: ============================================================
:: FERTIG
:: ============================================================
echo.
echo ============================================================
echo  Alle Abhaengigkeiten bereit!
echo.
echo  Naechster Schritt: Selektoren ermitteln
echo    codegen.bat starten, einloggen, Klickweg aufnehmen,
echo    Ergebnis in core\downloader.js eintragen.
echo.
echo  Dann App starten:
echo    start.bat
echo ============================================================
echo.
pause
