@echo off
setlocal enabledelayedexpansion
title OP ePaper Tool

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

npx electron .
