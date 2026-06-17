# Playwright Selektor-Recorder
# Oeffnet https://epaper.op-online.de im Browser und zeichnet Klicks auf.
# Voraussetzung: setup.bat wurde erfolgreich ausgefuehrt.
#
# Wichtig: 'codegen' nutzt NICHT den exe-Pfad aus browser-path.txt, sondern
# einen "channel" (chrome/msedge) eines installierten Marken-Browsers.
# Dadurch entfaellt das eingebaute Chromium komplett (kein Versions-Mismatch,
# kein 150-MB-Download, kein haengendes Entpacken).

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

# Installierten Marken-Browser fuer den codegen-Channel finden
function Find-Channel {
    $pf   = $env:ProgramFiles
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $lad  = $env:LOCALAPPDATA

    $chrome = @(
        (Join-Path $pf  'Google\Chrome\Application\chrome.exe'),
        (Join-Path $lad 'Google\Chrome\Application\chrome.exe')
    )
    if ($pf86) { $chrome += (Join-Path $pf86 'Google\Chrome\Application\chrome.exe') }
    foreach ($c in $chrome) { if ($c -and (Test-Path $c)) { return 'chrome' } }

    $edge = @( (Join-Path $pf 'Microsoft\Edge\Application\msedge.exe') )
    if ($pf86) { $edge += (Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe') }
    foreach ($c in $edge) { if ($c -and (Test-Path $c)) { return 'msedge' } }

    return $null
}

$channel = Find-Channel
if (-not $channel) {
    Write-Host "[FEHLER] Weder Chrome noch Edge gefunden." -ForegroundColor Red
    Write-Host "         Bitte Google Chrome installieren und erneut versuchen:" -ForegroundColor Red
    Write-Host "         https://www.google.com/intl/de/chrome/?standalone=1"
    exit 1
}
Write-Host "Browser-Channel: $channel" -ForegroundColor DarkGray

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
Write-Host "(npx playwright@$pwVer codegen --channel=$channel)" -ForegroundColor DarkGray
Write-Host ""

# --channel nutzt den installierten Browser - kein Chromium-Download noetig
$cmdLine = "`"$npxCmd`" --yes playwright@$pwVer codegen --channel=$channel https://epaper.op-online.de"
Write-Host "> $cmdLine" -ForegroundColor DarkGray
cmd.exe /c $cmdLine
