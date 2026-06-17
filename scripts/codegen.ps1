# Playwright Selektor-Recorder - nimmt den Klickweg auf der ePaper-Seite auf.
#
# Hinweis: 'codegen' steckt im vollen 'playwright'-Paket, nicht in
# 'playwright-core'. Wir nutzen npx playwright@<passende Version>.
# Vor dem Start wird geprueft ob die passende Chromium-Revision vorhanden ist;
# fehlt sie, wird sie automatisch installiert (einmalig ~150 MB).

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

# Passende Playwright-Version aus playwright-core ermitteln
$pwCorePkg = Join-Path $ProjectDir 'node_modules\playwright-core\package.json'
$pwVer = '1.49.1'
if (Test-Path $pwCorePkg) {
    try { $pwVer = ((Get-Content $pwCorePkg -Raw | ConvertFrom-Json).version) } catch {}
}

# Chromium-Revision fuer diese playwright-Version ermitteln
$pwRevision = $null
if (Test-Path $pwCorePkg) {
    try {
        $pwPkg = Get-Content $pwCorePkg -Raw | ConvertFrom-Json
        $chromiumEntry = $pwPkg.browsers | Where-Object { $_.name -eq 'chromium' } | Select-Object -First 1
        if ($chromiumEntry) { $pwRevision = $chromiumEntry.revision }
    } catch {}
}

# Pruefen ob passende Chromium-Revision vorhanden ist
$pwBrowserBase = Join-Path $env:LOCALAPPDATA 'ms-playwright'
$chromiumOk    = $false
if ($pwRevision -and (Test-Path $pwBrowserBase)) {
    $expectedDir = Join-Path $pwBrowserBase "chromium-$pwRevision"
    if (Test-Path (Join-Path $expectedDir 'chrome-win\chrome.exe')) {
        $chromiumOk = $true
    }
}

if (-not $chromiumOk) {
    if ($pwRevision) {
        Write-Host "Chromium-Revision $pwRevision fehlt - wird jetzt installiert (~150 MB)..." -ForegroundColor Yellow
    } else {
        Write-Host "Chromium wird installiert (~150 MB)..." -ForegroundColor Yellow
    }
    # playwright-core install chromium holt die exakt passende Revision
    $pwCoreBin = Join-Path $ProjectDir 'node_modules\.bin\playwright-core.cmd'
    if (Test-Path $pwCoreBin) {
        cmd.exe /c "`"$pwCoreBin`" install chromium"
    } else {
        $cliJs = Join-Path $ProjectDir 'node_modules\playwright-core\lib\cli\cli.js'
        if (-not (Test-Path $cliJs)) {
            $cliJs = Join-Path $ProjectDir 'node_modules\playwright-core\cli.js'
        }
        if (Test-Path $cliJs) {
            cmd.exe /c "`"$(Join-Path $nodeDir 'node.exe')`" `"$cliJs`" install chromium"
        }
    }
    # Nochmals pruefen
    if ($pwRevision -and (Test-Path $pwBrowserBase)) {
        $expectedDir = Join-Path $pwBrowserBase "chromium-$pwRevision"
        if (Test-Path (Join-Path $expectedDir 'chrome-win\chrome.exe')) {
            $chromiumOk = $true
        }
    }
    if (-not $chromiumOk) {
        Write-Host "[FEHLER] Chromium-Installation fehlgeschlagen. Bitte setup.bat erneut ausfuehren." -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Chromium bereit" -ForegroundColor Green
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

# Ueber cmd.exe ausfuehren - umgeht PowerShell-Quoting-Fallen
$cmdLine = "`"$npxCmd`" --yes playwright@$pwVer codegen https://epaper.op-online.de"
Write-Host "> $cmdLine" -ForegroundColor DarkGray
cmd.exe /c $cmdLine
