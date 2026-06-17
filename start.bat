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
    echo [FEHLER] Electron nicht gefunden in: %ELECTRON_BIN%
    echo Bitte zuerst install-deps.bat ausfuehren.
    pause
    exit /b 1
)

echo Starte Electron...
echo (Fehlermeldungen erscheinen hier falls etwas schiefgeht)
echo --------------------------------------------------------
"%ELECTRON_BIN%" . --enable-logging
set "EC=%errorlevel%"
echo --------------------------------------------------------
if not "%EC%"=="0" (
    echo.
    echo [FEHLER] Electron beendet mit Code %EC%
    echo Crash-Log: %USERPROFILE%\op-epaper-crash.log
)
pause
