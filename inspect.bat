@echo off
title OP ePaper - Portal-Inspektor
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\inspect.ps1
pause
