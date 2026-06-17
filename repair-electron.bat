@echo off
:: cmd /k als aeussere Huelle: Fenster bleibt IMMER offen, egal was passiert
if not "%1"=="__RUN__" (
    cmd /k ""%~f0" __RUN__"
    exit /b
)

setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ============================================================
echo  Electron Binary Reparatur
echo ============================================================
echo.

:: ---- Node.js finden --------------------------------------------------------
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
            goto :node_ok
        )
    )
    echo [FEHLER] Node.js nicht gefunden. Bitte zuerst install-deps.bat ausfuehren.
    goto :end
)
:node_ok
for /f "tokens=*" %%V in ('node --version') do echo [OK] Node.js %%V

:: ---- Electron-Version lesen (KEIN Backtick-for, da ) den Parser bricht) ---
set "EPKG=%~dp0node_modules\electron\package.json"
if not exist "%EPKG%" (
    echo [FEHLER] node_modules\electron\package.json nicht gefunden.
    echo Bitte install-deps.bat erneut ausfuehren.
    goto :end
)

:: Version in Tempfile schreiben, dann mit set /p einlesen
node -e "process.stdout.write(require('%EPKG:\=/%').version)" > "%TEMP%\_eversion.txt" 2>&1
set /p EVERSION= < "%TEMP%\_eversion.txt"
del "%TEMP%\_eversion.txt" >nul 2>&1

if "!EVERSION!"=="" (
    echo [FEHLER] Konnte Electron-Version nicht lesen.
    goto :end
)
echo [OK] Electron-Version: !EVERSION!

:: ---- Zielverzeichnis -------------------------------------------------------
set "DIST_DIR=%~dp0node_modules\electron\dist"
set "ELECTRON_EXE=!DIST_DIR!\electron.exe"
set "PATH_TXT=%~dp0node_modules\electron\path.txt"

if exist "!ELECTRON_EXE!" (
    echo [INFO] electron.exe bereits vorhanden - erneuere trotzdem path.txt
    echo dist\electron.exe> "!PATH_TXT!"
    echo [OK] path.txt repariert. Starte jetzt start.bat.
    goto :end
)

:: ---- Binary-ZIP von GitHub laden -------------------------------------------
set "ZIP_URL=https://github.com/electron/electron/releases/download/v!EVERSION!/electron-v!EVERSION!-win32-x64.zip"
set "ZIP_TMP=%TEMP%\_electron_bin.zip"
set "ZIP_EXTRACT=%TEMP%\_electron_extract"

echo.
echo Lade Electron Binary (~90 MB) herunter...
echo URL: !ZIP_URL!
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { Invoke-WebRequest -Uri '!ZIP_URL!' -OutFile '!ZIP_TMP!' -UseBasicParsing; Write-Host 'Download OK' } catch { Write-Host ('Download FEHLER: ' + $_.Exception.Message); exit 1 }"

if not exist "!ZIP_TMP!" (
    echo.
    echo [FEHLER] Download fehlgeschlagen (Netzwerk oder Proxy).
    echo.
    echo Manuelle Alternative:
    echo   1. Oeffne im Browser:  !ZIP_URL!
    echo   2. Speichere die ZIP als:  !DIST_DIR!\..\electron_bin.zip
    echo      (also im Ordner node_modules\electron\)
    echo   3. Starte diese Datei erneut - sie erkennt die ZIP automatisch.
    goto :end
)

:: ---- Auch manuell gelegte ZIP akzeptieren ----------------------------------
:extract
echo Entpacke ZIP...
if exist "!ZIP_EXTRACT!" rmdir /s /q "!ZIP_EXTRACT!" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { Expand-Archive -Path '!ZIP_TMP!' -DestinationPath '!ZIP_EXTRACT!' -Force; Write-Host 'Entpackt OK' } catch { Write-Host ('Entpacken FEHLER: ' + $_.Exception.Message); exit 1 }"

if not exist "!ZIP_EXTRACT!\electron.exe" (
    echo [FEHLER] electron.exe nicht im ZIP gefunden.
    echo Inhalt von !ZIP_EXTRACT!:
    dir "!ZIP_EXTRACT!" /b 2>nul
    goto :end
)

:: ---- In dist\ kopieren -----------------------------------------------------
if not exist "!DIST_DIR!" mkdir "!DIST_DIR!"
echo Kopiere nach !DIST_DIR!...
xcopy /e /y /q "!ZIP_EXTRACT!\*" "!DIST_DIR!\" >nul 2>&1
rmdir /s /q "!ZIP_EXTRACT!" >nul 2>&1
del "!ZIP_TMP!" >nul 2>&1

:: ---- path.txt schreiben ----------------------------------------------------
echo dist\electron.exe> "!PATH_TXT!"

:: ---- Ergebnis pruefen ------------------------------------------------------
if exist "!ELECTRON_EXE!" (
    echo.
    echo [OK] Electron Binary erfolgreich installiert:
    echo      !ELECTRON_EXE!
    echo.
    echo Starte jetzt start.bat
) else (
    echo.
    echo [FEHLER] electron.exe immer noch nicht gefunden nach dem Kopieren.
    echo Inhalt von !DIST_DIR!:
    dir "!DIST_DIR!" /b 2>nul
)

:end
echo.
echo ============================================================
echo  Fertig. Dieses Fenster kannst du schliessen.
echo ============================================================
