# Playwright Selektor-Recorder - nimmt den Klickweg auf der ePaper-Seite auf.
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

function Find-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($c in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    )) { if (Test-Path $c) { return $c } }
    return $null
}

$nodeExe = Find-NodeExe
if (-not $nodeExe) {
    Write-Host "[FEHLER] Node.js nicht gefunden. Bitte zuerst setup.bat ausfuehren." -ForegroundColor Red
    exit 1
}

$pwCli = Join-Path $ProjectDir 'node_modules\playwright\cli.js'
if (-not (Test-Path $pwCli)) {
    Write-Host "[FEHLER] Playwright nicht installiert. Bitte zuerst setup.bat ausfuehren." -ForegroundColor Red
    exit 1
}

Write-Host "Oeffne Browser fuer https://epaper.op-online.de ..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Klickweg aufnehmen:"
Write-Host "  1. Einloggen"
Write-Host "  2. Zur Dreieich-Ausgabe navigieren"
Write-Host "  3. PDF-Download-Button klicken"
Write-Host "  4. Generierten Code rechts kopieren"
Write-Host "  5. In core\downloader.js bei SEL_* und DOWNLOAD_SELECTOR eintragen"
Write-Host ""

& $nodeExe $pwCli codegen https://epaper.op-online.de
