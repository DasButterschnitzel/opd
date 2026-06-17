@echo off
setlocal
title OP ePaper Tool
cd /d "%~dp0"

set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" (
    echo Electron ist noch nicht eingerichtet - starte Setup...
    call "%~dp0setup.bat"
)

if not exist "%ELECTRON_EXE%" (
    echo.
    echo [FEHLER] Electron fehlt weiterhin. Bitte setup.bat pruefen.
    pause
    exit /b 1
)

:: electron.exe ist eine .exe (kein .cmd) - laeuft direkt, kein "call" noetig.
"%ELECTRON_EXE%" "%~dp0"
set "EC=%errorlevel%"

if not "%EC%"=="0" (
    echo.
    echo [FEHLER] App beendet mit Code %EC%
    echo Crash-Log: %USERPROFILE%\op-epaper-crash.log
    pause
)
