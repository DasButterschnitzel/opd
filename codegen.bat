@echo off
title Playwright Selektor-Recorder
echo Oeffne Browser fuer https://epaper.op-online.de ...
echo.
echo Klickweg aufnehmen:
echo   1. Einloggen
echo   2. Zur Dreieich-Ausgabe navigieren
echo   3. PDF-Download-Button klicken
echo   4. Generierten Code rechts kopieren
echo   5. In core\downloader.js bei SEL_* und DOWNLOAD_SELECTOR eintragen
echo.
npx playwright codegen https://epaper.op-online.de
pause
