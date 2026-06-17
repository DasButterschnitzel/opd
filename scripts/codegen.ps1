# Playwright Selektor-Recorder
# Oeffnet https://epaper.op-online.de im Browser und zeichnet Klicks auf.
# Voraussetzung: setup.bat wurde erfolgreich ausgefuehrt.

$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

function Find-NodeDir {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return (Split-Path -Parent $cmd.Source) }
    $roots = @($env:LOCALAPPDATA, $env:ProgramFiles, $env:APPDATA)
    $subs  = @('Programs\nodejs', 'nodejs', 'nvm\current')
    foreach ($r in $roots) {
        if ([string]::IsNullOrEmpty($r)) { continue }
        foreach ($s in $subs) {
            $d = Join-Path $r $s
            if (Test-Path (Join-Path $d 'node.exe')) { return $d }
        }
    }
    return $null
}

$nodeDir = Find-NodeDir
if (-not $nodeDir) {
    Write-Host "[FEHLER] Node.js nicht gefunden. Bitte zuerst setup.bat ausfuehren." -ForegroundColor Red
    exit 1
}
$env:Path = "$nodeDir;" + $env:Path
$npxCmd = Join-Path $nodeDir 'npx.cmd'

# Browser-Pfad aus setup.ps1 laden
$browserPathTxt = Join-Path $ProjectDir 'browser-path.txt'
if (-not (Test-Path $browserPathTxt)) {
    Write-Host "[FEHLER] browser-path.txt fehlt. Bitte zuerst setup.bat ausfuehren." -ForegroundColor Red
    exit 1
}
$browserExe = (Get-Content $browserPathTxt -Raw).Trim()
if (-not (Test-Path $browserExe)) {
    Write-Host "[FEHLER] Browser nicht gefunden: $browserExe" -ForegroundColor Red
    Write-Host "         Bitte setup.bat erneut ausfuehren." -ForegroundColor Red
    exit 1
}

# Dem playwright-codegen-Prozess mitteilen welchen Browser er nutzen soll
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = $browserExe
Write-Host "Browser: $browserExe" -ForegroundColor DarkGray

# Playwright-Version aus playwright-core ermitteln
$pwCorePkg = Join-Path $ProjectDir 'node_modules\playwright-core\package.json'
$pwVer = '1.49.1'
if (Test-Path $pwCorePkg) {
    try { $pwVer = ((Get-Content $pwCorePkg -Raw | ConvertFrom-Json).version) } catch {}
}

Write-Host ""
Write-Host "Oeffne Browser fuer https://epaper.op-online.de ..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Klickweg aufnehmen:"
Write-Host "  1. Einloggen"
Write-Host "  2. Zur Dreieich-Ausgabe navigieren"
Write-Host "  3. PDF-Download-Button klicken"
Write-Host "  4. Generierten Code rechts kopieren"
Write-Host "  5. In core\downloader.js bei SEL_* und DOWNLOAD_SELECTOR eintragen"
Write-Host ""
Write-Host "(npx playwright@$pwVer codegen)" -ForegroundColor DarkGray
Write-Host ""

$cmdLine = "`"$npxCmd`" --yes playwright@$pwVer codegen https://epaper.op-online.de"
Write-Host "> $cmdLine" -ForegroundColor DarkGray
cmd.exe /c $cmdLine
