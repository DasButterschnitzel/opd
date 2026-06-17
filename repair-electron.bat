@echo off
setlocal enabledelayedexpansion
title Electron Reparatur
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
    ) do (
        if exist "%%~P\node.exe" (
            set "PATH=%%~P;!PATH!"
            goto :node_found
        )
    )
    echo [FEHLER] Node.js nicht gefunden.
    pause & exit /b 1
)
:node_found

echo ============================================================
echo  Electron Binary Reparatur
echo ============================================================
echo.

:: Electron-Version aus node_modules lesen
for /f "usebackq tokens=*" %%V in (`node -e "process.stdout.write(require('./node_modules/electron/package.json').version)"`) do set "EVERSION=%%V"
if "!EVERSION!"=="" (
    echo [FEHLER] Kann Electron-Version nicht lesen.
    echo Bitte install-deps.bat erneut ausfuehren.
    pause & exit /b 1
)
echo Electron Version: !EVERSION!

set "DIST_DIR=%~dp0node_modules\electron\dist"
set "ELECTRON_EXE=%DIST_DIR%\electron.exe"

:: Pruefen ob Binary schon existiert
if exist "%ELECTRON_EXE%" (
    echo Binary bereits vorhanden: %ELECTRON_EXE%
    echo Starte Reparatur trotzdem (path.txt erneuern)...
)

:: GitHub-Download-URL zusammenbauen
set "ZIP_URL=https://github.com/electron/electron/releases/download/v!EVERSION!/electron-v!EVERSION!-win32-x64.zip"
set "ZIP_TMP=%TEMP%\electron-win32-x64.zip"
set "ZIP_EXTRACT=%TEMP%\electron-extract"

echo.
echo Lade Electron Binary herunter (~90 MB)...
echo URL: !ZIP_URL!
echo.

powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '!ZIP_URL!' -OutFile '!ZIP_TMP!' -UseBasicParsing"

if not exist "!ZIP_TMP!" (
    echo.
    echo [FEHLER] Download fehlgeschlagen.
    echo.
    echo Bitte manuell:
    echo   1. Im Browser oeffnen: !ZIP_URL!
    echo   2. ZIP herunterladen
    echo   3. Inhalt entpacken nach: %DIST_DIR%
    echo      (so dass dort electron.exe liegt)
    echo   4. start.bat erneut starten
    pause & exit /b 1
)

echo Entpacke...
if exist "!ZIP_EXTRACT!" rmdir /s /q "!ZIP_EXTRACT!"
powershell -NoProfile -Command "Expand-Archive -Path '!ZIP_TMP!' -DestinationPath '!ZIP_EXTRACT!' -Force"
del "!ZIP_TMP!" >nul 2>&1

if not exist "!ZIP_EXTRACT!\electron.exe" (
    echo [FEHLER] electron.exe nicht im ZIP gefunden.
    pause & exit /b 1
)

:: dist-Verzeichnis befuellen
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
echo Kopiere nach %DIST_DIR%...
xcopy /e /y /q "!ZIP_EXTRACT!\*" "%DIST_DIR%\" >nul
rmdir /s /q "!ZIP_EXTRACT!" >nul 2>&1

:: path.txt schreiben (zeigt auf electron.exe)
echo dist\electron.exe> "%~dp0node_modules\electron\path.txt"

:: Pruefen
if exist "%ELECTRON_EXE%" (
    echo.
    echo [OK] Electron Binary erfolgreich installiert.
    echo      %ELECTRON_EXE%
    echo.
    echo Starte jetzt start.bat
) else (
    echo [FEHLER] electron.exe immer noch nicht gefunden.
)
echo.
pause
