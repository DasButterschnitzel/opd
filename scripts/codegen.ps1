# Playwright Selektor-Recorder - nimmt den Klickweg auf der ePaper-Seite auf.
#
# Hinweis: 'codegen' steckt im vollen 'playwright'-Paket, nicht in
# 'playwright-core' (das wir zur Laufzeit nutzen). Wir holen es per npx in der
# Version, die zum installierten Chromium passt - dann kein Browser-Nachladen.

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

# Passende Playwright-Version aus playwright-core ermitteln (Chromium-Match)
$pwCorePkg = Join-Path $ProjectDir 'node_modules\playwright-core\package.json'
$pwVer = '1.49.1'
if (Test-Path $pwCorePkg) {
    try { $pwVer = ((Get-Content $pwCorePkg -Raw | ConvertFrom-Json).version) } catch {}
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
Write-Host "(Playwright $pwVer wird bei Bedarf per npx geladen)" -ForegroundColor DarkGray
Write-Host ""

# Ueber cmd.exe ausfuehren - umgeht PowerShell-Quoting-Fallen
$cmdLine = "`"$npxCmd`" --yes playwright@$pwVer codegen https://epaper.op-online.de"
Write-Host "> $cmdLine" -ForegroundColor DarkGray
cmd.exe /c $cmdLine
