@echo off
setlocal enabledelayedexpansion
title OP ePaper Tool
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
    echo [FEHLER] Node.js nicht gefunden. Bitte zuerst install-deps.bat ausfuehren.
    pause
    exit /b 1
)
:node_found

set "ELECTRON_BIN=%~dp0node_modules\.bin\electron.cmd"
if not exist "%ELECTRON_BIN%" (
    echo [FEHLER] Electron nicht gefunden: %ELECTRON_BIN%
    echo Bitte zuerst install-deps.bat ausfuehren.
    pause
    exit /b 1
)

:: Fehlerausgabe in Logdatei schreiben (parallel zur Konsole)
set "CRASH_LOG=%USERPROFILE%\op-epaper-crash.log"
echo. >> "%CRASH_LOG%"
echo === Start: %DATE% %TIME% === >> "%CRASH_LOG%"

echo Starte OP ePaper Tool...
echo (Fenster bleibt offen wenn Fehler auftreten)
echo -----------------------------------------------

:: WICHTIG: "call" damit die Rueckkehr zur .bat gewaehrleistet ist
::          Fehlerausgabe in Logdatei UND Konsole gleichzeitig
call "%ELECTRON_BIN%" . 2>> "%CRASH_LOG%"

set "EC=%errorlevel%"
echo -----------------------------------------------
if "%EC%"=="0" (
    echo Electron normal beendet.
) else (
    echo.
    echo [FEHLER] Electron beendet mit Code %EC%
    echo.
    echo Letzte Zeilen aus dem Crash-Log:
    echo   %CRASH_LOG%
    echo.
    powershell -NoProfile -Command "Get-Content '%CRASH_LOG%' -Tail 20"
)
echo.
pause
