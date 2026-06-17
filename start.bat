@echo off
setlocal enabledelayedexpansion
title OP ePaper Tool
chcp 65001 >nul 2>&1

:: Ins Projektverzeichnis wechseln (egal wo start.bat aufgerufen wird)
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

:: Electron direkt aus node_modules starten (zuverlaessiger als npx)
set "ELECTRON_BIN=%~dp0node_modules\.bin\electron.cmd"
if not exist "%ELECTRON_BIN%" (
    echo [FEHLER] Electron nicht gefunden. Bitte zuerst install-deps.bat ausfuehren.
    pause
    exit /b 1
)

"%ELECTRON_BIN%" .
if errorlevel 1 (
    echo.
    echo [FEHLER] Electron wurde mit Fehlercode %errorlevel% beendet.
    pause
)
