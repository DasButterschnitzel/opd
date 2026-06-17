# =============================================================================
#  OP ePaper Tool – Einrichtung (PowerShell, ohne Adminrechte)
#
#  Erledigt alles in einem Durchlauf:
#    1. Node.js finden (oder ohne Admin als ZIP nach LOCALAPPDATA installieren)
#    2. npm-Pakete installieren
#    3. Electron-Binary sicherstellen (lädt es notfalls direkt von GitHub –
#       der npm-Postinstall wird in Firmennetzen oft geblockt)
#    4. Playwright Chromium installieren
#
#  Wird über setup.bat aufgerufen. Direkt:
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
# =============================================================================

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Projekt-Wurzel = ein Verzeichnis über diesem Skript
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "[OK] $t"   -ForegroundColor Green }
function Info($t) { Write-Host "     $t"   -ForegroundColor Gray }
function Fail($t) { Write-Host "[FEHLER] $t" -ForegroundColor Red }

Write-Host "============================================================"
Write-Host " OP ePaper Tool - Einrichtung (kein Admin noetig)"
Write-Host "============================================================"

# -----------------------------------------------------------------------------
# 1) NODE.JS
# -----------------------------------------------------------------------------
function Find-NodeDir {
    # a) Bereits im PATH?
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return (Split-Path -Parent $cmd.Source) }

    # b) Bekannte benutzer-lokale Orte (nur gesetzte Basis-Pfade verwenden)
    $bases = @(
        @{ Root = $env:LOCALAPPDATA;        Sub = 'Programs\nodejs' },
        @{ Root = $env:ProgramFiles;        Sub = 'nodejs' },
        @{ Root = ${env:ProgramFiles(x86)}; Sub = 'nodejs' },
        @{ Root = $env:APPDATA;             Sub = 'nvm\current' },
        @{ Root = $env:LOCALAPPDATA;        Sub = 'nvm\current' }
    )
    foreach ($b in $bases) {
        if ([string]::IsNullOrEmpty($b.Root)) { continue }
        $dir = Join-Path $b.Root $b.Sub
        if (Test-Path (Join-Path $dir 'node.exe')) { return $dir }
    }
    return $null
}

function Install-NodePortable {
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
    Info "Node.js nicht gefunden - installiere portabel nach:"
    Info "  $installDir"

    Info "Ermittle aktuelle LTS-Version..."
    $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $lts   = $index | Where-Object { $_.lts } | Select-Object -First 1
    $ver   = $lts.version
    Info "LTS: $ver"

    $zipUrl  = "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip"
    $zipPath = Join-Path $env:TEMP 'node-portable.zip'
    $extract = Join-Path $env:TEMP 'node-portable-extract'

    Info "Lade $zipUrl ..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Info "Entpacke..."
    Expand-Archive -Path $zipPath -DestinationPath $extract -Force

    $inner = Join-Path $extract "node-$ver-win-x64"
    if (-not (Test-Path (Join-Path $inner 'node.exe'))) {
        throw "node.exe nicht im heruntergeladenen Archiv gefunden."
    }

    if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path -Parent $installDir) -Force | Out-Null
    Move-Item $inner $installDir
    Remove-Item $zipPath, $extract -Recurse -Force -ErrorAction SilentlyContinue

    # Benutzer-PATH dauerhaft erweitern (kein Admin, HKCU)
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -notlike "*$installDir*") {
        [Environment]::SetEnvironmentVariable('Path', "$installDir;$userPath", 'User')
        Info "Benutzer-PATH dauerhaft erweitert."
    }
    return $installDir
}

Step "1/4  Node.js"
$nodeDir = Find-NodeDir
if (-not $nodeDir) {
    try {
        $nodeDir = Install-NodePortable
    } catch {
        Fail "Node.js konnte nicht automatisch installiert werden: $($_.Exception.Message)"
        Write-Host ""
        Write-Host "Manuelle Alternative (kein Admin):"
        Write-Host "  1. https://nodejs.org -> LTS -> 'Windows Binary (.zip)' laden"
        Write-Host "  2. Entpacken nach:  $(Join-Path $env:LOCALAPPDATA 'Programs\nodejs')"
        Write-Host "  3. setup.bat erneut starten"
        exit 1
    }
}
# Node-Verzeichnis für diese Sitzung an den Anfang des PATH
$env:Path = "$nodeDir;$env:Path"

$nodeExe = Join-Path $nodeDir 'node.exe'
$npmCmd  = Join-Path $nodeDir 'npm.cmd'
$nodeVer = (& $nodeExe --version)
Ok "Node.js $nodeVer  ($nodeDir)"

# -----------------------------------------------------------------------------
# 2) NPM-PAKETE
# -----------------------------------------------------------------------------
Step "2/4  npm-Pakete"
$electronPkg = Join-Path $ProjectDir 'node_modules\electron\package.json'
$playwrightPkg = Join-Path $ProjectDir 'node_modules\playwright\package.json'

if ((-not (Test-Path $electronPkg)) -or (-not (Test-Path $playwrightPkg))) {
    Info "Installiere npm-Pakete (dauert 1-3 Minuten)..."
    # Binary-Downloads beim Postinstall ueberspringen - wir holen sie separat in
    # Schritt 3 und 4 (zuverlaessiger in Firmennetzen mit Proxy/Block).
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
    & $npmCmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm install fehlgeschlagen."; exit 1 }
    Ok "npm-Pakete installiert"
} else {
    Ok "node_modules bereits vorhanden"
}

# -----------------------------------------------------------------------------
# 3) ELECTRON-BINARY
# -----------------------------------------------------------------------------
Step "3/4  Electron-Binary"
$electronDir = Join-Path $ProjectDir 'node_modules\electron'
$distDir     = Join-Path $electronDir 'dist'
$electronExe = Join-Path $distDir 'electron.exe'
$pathTxt     = Join-Path $electronDir 'path.txt'

function Repair-PathTxt {
    # electron/index.js liest path.txt und macht: join(__dirname, 'dist', <inhalt>)
    # -> der Inhalt MUSS exakt "electron.exe" sein (ohne 'dist\').
    Set-Content -Path $pathTxt -Value 'electron.exe' -NoNewline -Encoding ascii
}

if (Test-Path $electronExe) {
    Repair-PathTxt
    Ok "Electron-Binary vorhanden – path.txt geprueft"
} else {
    $ever = (Get-Content $electronPkg -Raw | ConvertFrom-Json).version
    Info "Benoetigte Version: $ever"
    $zipUrl  = "https://github.com/electron/electron/releases/download/v$ever/electron-v$ever-win32-x64.zip"
    $zipPath = Join-Path $env:TEMP 'electron-bin.zip'
    $extract = Join-Path $env:TEMP 'electron-bin-extract'

    try {
        Info "Lade Electron-Binary (~100 MB) von GitHub..."
        Info $zipUrl
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

        if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
        Info "Entpacke..."
        Expand-Archive -Path $zipPath -DestinationPath $extract -Force

        if (-not (Test-Path (Join-Path $extract 'electron.exe'))) {
            throw "electron.exe nicht im Archiv gefunden."
        }

        New-Item -ItemType Directory -Path $distDir -Force | Out-Null
        Info "Kopiere nach dist\ ..."
        Copy-Item -Path (Join-Path $extract '*') -Destination $distDir -Recurse -Force

        Repair-PathTxt
        Remove-Item $zipPath, $extract -Recurse -Force -ErrorAction SilentlyContinue

        if (Test-Path $electronExe) {
            Ok "Electron-Binary installiert"
        } else {
            throw "electron.exe nach dem Kopieren nicht vorhanden."
        }
    } catch {
        Fail "Electron-Binary konnte nicht geladen werden: $($_.Exception.Message)"
        Write-Host ""
        Write-Host "Manuelle Alternative:"
        Write-Host "  1. Im Browser oeffnen:  $zipUrl"
        Write-Host "  2. ZIP-Inhalt entpacken nach:  $distDir"
        Write-Host "     (so dass dort electron.exe liegt)"
        Write-Host "  3. setup.bat erneut starten (schreibt dann path.txt)"
        exit 1
    }
}

# -----------------------------------------------------------------------------
# 4) PLAYWRIGHT CHROMIUM
# -----------------------------------------------------------------------------
Step "4/4  Playwright Chromium"
$pwCli = Join-Path $ProjectDir 'node_modules\playwright\cli.js'
if (-not (Test-Path $pwCli)) {
    $pwCli = Join-Path $ProjectDir 'node_modules\playwright-core\cli.js'
}
if (-not (Test-Path $pwCli)) {
    Fail "Playwright-CLI nicht gefunden – npm install unvollstaendig?"
    exit 1
}

Info "Installiere/aktualisiere Chromium (idempotent)..."
& $nodeExe $pwCli install chromium
if ($LASTEXITCODE -ne 0) {
    Fail "Chromium-Installation fehlgeschlagen."
    exit 1
}
Ok "Chromium bereit"

# -----------------------------------------------------------------------------
# FERTIG
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Alle Abhaengigkeiten bereit!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host " Naechster Schritt: Selektoren ermitteln"
Write-Host "   codegen.bat starten, einloggen, Klickweg aufnehmen,"
Write-Host "   Ergebnis in core\downloader.js eintragen."
Write-Host ""
Write-Host " Dann App starten:  start.bat"
Write-Host ""
exit 0
