# =============================================================================
#  OP ePaper Tool - Einrichtung  (PowerShell, kein Admin noetig)
#
#  Aufruf:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
# =============================================================================

$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

# Explizite Fehlerbehandlung statt globalem Stop - so sieht man was schiefgeht
$ErrorActionPreference = 'Continue'

function Step($n, $t) { Write-Host "`n=== $n  $t ===" -ForegroundColor Cyan }
function Ok($t)        { Write-Host "[OK] $t"         -ForegroundColor Green }
function Info($t)      { Write-Host "     $t" }
function Fail($t)      { Write-Host "[FEHLER] $t"     -ForegroundColor Red }
function Run($cmd)     { Write-Host "     > $cmd"     -ForegroundColor DarkGray }

# ---- Hilfsfunktion: Befehl ueber cmd.exe ausfuehren (umgeht PS-Quoting-Fallen) ----
function Invoke-Cmd {
    param([string]$Cmd)
    Run $Cmd
    $result = cmd.exe /c $Cmd
    Write-Host $result
    return $LASTEXITCODE
}

# =============================================================================
# 1) NODE.JS FINDEN ODER PORTABEL INSTALLIEREN
# =============================================================================
Step 1 "Node.js"

function Find-NodeDir {
    # Zuerst im System-PATH
    $n = Get-Command node -ErrorAction SilentlyContinue
    if ($n) { return (Split-Path -Parent $n.Source) }

    # Dann bekannte Installationsorte (null-sichere Iteration)
    $roots = @($env:LOCALAPPDATA, $env:ProgramFiles, $env:APPDATA)
    $subs  = @('Programs\nodejs', 'nodejs', 'nvm\current')
    foreach ($r in $roots) {
        if ([string]::IsNullOrEmpty($r)) { continue }
        foreach ($s in $subs) {
            $candidate = Join-Path $r $s
            if (Test-Path (Join-Path $candidate 'node.exe')) { return $candidate }
        }
    }
    return $null
}

$nodeDir = Find-NodeDir

if (-not $nodeDir) {
    Info "Node.js nicht gefunden - installiere portabel (ZIP, kein Admin)..."

    try {
        $index  = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
        $lts    = $index | Where-Object { $_.lts } | Select-Object -First 1
        $ver    = $lts.version
        $zipUrl = "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip"
        $zip    = Join-Path $env:TEMP 'node-portable.zip'
        $exdir  = Join-Path $env:TEMP 'node-portable-extract'
        $target = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'

        Info "Lade Node.js $ver ..."
        Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing

        if (Test-Path $exdir) { Remove-Item $exdir -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $exdir -Force
        $inner = Join-Path $exdir "node-$ver-win-x64"

        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Move-Item $inner $target

        Remove-Item $zip -Force -ErrorAction SilentlyContinue
        Remove-Item $exdir -Recurse -Force -ErrorAction SilentlyContinue

        # Dauerhaft in Benutzer-PATH eintragen (HKCU, kein Admin)
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath -notlike "*$target*") {
            [Environment]::SetEnvironmentVariable('Path', "$target;$userPath", 'User')
        }
        $nodeDir = $target
    } catch {
        Fail "Automatische Installation fehlgeschlagen: $($_.Exception.Message)"
        Write-Host ""
        Write-Host "Manuell (kein Admin):"
        Write-Host "  1. https://nodejs.org  -> LTS -> Windows Binary (.zip)"
        Write-Host "  2. Entpacken nach: $env:LOCALAPPDATA\Programs\nodejs"
        Write-Host "  3. setup.bat erneut starten"
        Read-Host "Taste druecken zum Beenden"
        exit 1
    }
}

# Fuer diese Sitzung in PATH aufnehmen
$env:Path = "$nodeDir;" + $env:Path

$nodeExe  = Join-Path $nodeDir 'node.exe'
$npmCmd   = Join-Path $nodeDir 'npm.cmd'
$npxCmd   = Join-Path $nodeDir 'npx.cmd'
$nodeVer  = & $nodeExe --version

Ok "Node.js $nodeVer  ($nodeDir)"

# =============================================================================
# 2) NPM-PAKETE
# =============================================================================
Step 2 "npm-Pakete"

$electronPkg    = Join-Path $ProjectDir 'node_modules\electron\package.json'
$playwrightPkg  = Join-Path $ProjectDir 'node_modules\playwright-core\package.json'

if ((-not (Test-Path $electronPkg)) -or (-not (Test-Path $playwrightPkg))) {
    Info "Installiere npm-Pakete (1-3 Minuten)..."
    # Binary-Postinstalls deaktivieren - wir holen die Binaries manuell in
    # Schritt 3 und 4 (Firmennetze blocken diese Downloads haeufig).
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD    = '1'
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

    $rc = Invoke-Cmd "`"$npmCmd`" install --no-audit --no-fund"
    if ($rc -ne 0) {
        Fail "npm install fehlgeschlagen (Code $rc)."
        Read-Host "Taste druecken zum Beenden"
        exit 1
    }
    Ok "npm-Pakete installiert"
} else {
    Ok "node_modules bereits vorhanden"
}

# =============================================================================
# 3) ELECTRON BINARY
# =============================================================================
Step 3 "Electron-Binary"

$electronDir = Join-Path $ProjectDir 'node_modules\electron'
$distDir     = Join-Path $electronDir 'dist'
$electronExe = Join-Path $distDir 'electron.exe'
$pathTxt     = Join-Path $electronDir 'path.txt'

# path.txt muss exakt "electron.exe" enthalten.
# Electrons index.js baut den Pfad als: path.join(__dirname, 'dist', <inhalt von path.txt>)
# -> alles andere als "electron.exe" fuehrt zu "Electron failed to install correctly"
function Write-PathTxt {
    [System.IO.File]::WriteAllText($pathTxt, 'electron.exe',
        [System.Text.Encoding]::ASCII)
    Info "path.txt geschrieben: $pathTxt"
}

if (Test-Path $electronExe) {
    Write-PathTxt
    Ok "Electron-Binary vorhanden, path.txt geprueft"
} else {
    # Version aus package.json lesen (ohne Backtick-for, der ) nicht vertraegt)
    $ePkgContent = Get-Content $electronPkg -Raw | ConvertFrom-Json
    $eVer = $ePkgContent.version
    Info "Benoetigt: electron $eVer"

    $zipUrl  = "https://github.com/electron/electron/releases/download/v$eVer/electron-v$eVer-win32-x64.zip"
    $zipPath = Join-Path $env:TEMP 'electron-bin.zip'
    $exdir   = Join-Path $env:TEMP 'electron-bin-extract'

    try {
        Info "Lade Electron-Binary (~100 MB) von GitHub..."
        Info $zipUrl
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

        if (Test-Path $exdir) { Remove-Item $exdir -Recurse -Force }
        Expand-Archive -Path $zipPath -DestinationPath $exdir -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

        if (-not (Test-Path (Join-Path $exdir 'electron.exe'))) {
            throw "electron.exe nicht im Archiv gefunden. Inhalt: $(Get-ChildItem $exdir | Select-Object -ExpandProperty Name)"
        }

        New-Item -ItemType Directory -Path $distDir -Force | Out-Null
        Copy-Item (Join-Path $exdir '*') -Destination $distDir -Recurse -Force
        Remove-Item $exdir -Recurse -Force -ErrorAction SilentlyContinue

        Write-PathTxt
        Ok "Electron-Binary installiert: $electronExe"
    } catch {
        Fail "Electron-Binary konnte nicht geladen werden: $($_.Exception.Message)"
        Write-Host ""
        Write-Host "Manuell:"
        Write-Host "  1. Browser: $zipUrl"
        Write-Host "  2. ZIP-Inhalt entpacken nach: $distDir"
        Write-Host "     (so dass $electronExe entsteht)"
        Write-Host "  3. setup.bat erneut starten"
        Read-Host "Taste druecken zum Beenden"
        exit 1
    }
}

# =============================================================================
# 4) BROWSER FUER PLAYWRIGHT
# =============================================================================
Step 4 "Browser fuer Playwright"

# Cascade: A) Playwright-Chromium (exakte Revision)
#          B) Anderes ms-playwright Chromium (z.B. von frueherer Installation)
#          C) System-Chrome
#          D) System-Edge (Chromium-basiert)
#          E) Download (letzter Ausweg)
# Ergebnis wird in browser-path.txt gespeichert - App und codegen.ps1 lesen daraus.

$browserPathTxt = Join-Path $ProjectDir 'browser-path.txt'
$useExePath     = $null

# -- A) Exakt passende Playwright-Chromium-Revision --
$pwPkgJson  = Join-Path $ProjectDir 'node_modules\playwright-core\package.json'
$pwRevision = $null
if (Test-Path $pwPkgJson) {
    try {
        $pwPkg = Get-Content $pwPkgJson -Raw | ConvertFrom-Json
        $chromiumEntry = $pwPkg.browsers | Where-Object { $_.name -eq 'chromium' } | Select-Object -First 1
        if ($chromiumEntry) { $pwRevision = $chromiumEntry.revision }
    } catch {}
}
$pwBrowserBase = Join-Path $env:LOCALAPPDATA 'ms-playwright'
if ($pwRevision -and (Test-Path $pwBrowserBase)) {
    $candidate = Join-Path $pwBrowserBase "chromium-$pwRevision\chrome-win\chrome.exe"
    if (Test-Path $candidate) { $useExePath = $candidate }
}

# -- B) Irgendein ms-playwright Chromium (neueste zuerst) --
if (-not $useExePath -and (Test-Path $pwBrowserBase)) {
    $dirs = Get-ChildItem $pwBrowserBase -Directory |
            Where-Object { $_.Name -like 'chromium-*' } |
            Sort-Object Name -Descending
    foreach ($d in $dirs) {
        $candidate = Join-Path $d.FullName 'chrome-win\chrome.exe'
        if (Test-Path $candidate) { $useExePath = $candidate; break }
    }
}

# -- C) System-Chrome --
if (-not $useExePath) {
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $chromePaths = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA  'Google\Chrome\Application\chrome.exe')
    )
    if ($pf86) { $chromePaths += (Join-Path $pf86 'Google\Chrome\Application\chrome.exe') }
    foreach ($c in $chromePaths) {
        if ($c -and (Test-Path $c)) { $useExePath = $c; break }
    }
}

# -- D) System-Edge --
if (-not $useExePath) {
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $edgePaths = @(
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
    if ($pf86) { $edgePaths += (Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe') }
    foreach ($c in $edgePaths) {
        if ($c -and (Test-Path $c)) { $useExePath = $c; break }
    }
}

# -- E) Download als letzter Ausweg --
if (-not $useExePath) {
    Info "Kein Browser gefunden - lade Playwright Chromium herunter (~150 MB)..."
    Info "(Das kann auf Firmennetzen laenger dauern - bitte warten)"

    $pwCoreBin = Join-Path $ProjectDir 'node_modules\.bin\playwright-core.cmd'
    if (Test-Path $pwCoreBin) {
        $rc = Invoke-Cmd "`"$pwCoreBin`" install chromium"
    } else {
        $cliJs = Join-Path $ProjectDir 'node_modules\playwright-core\lib\cli\cli.js'
        if (-not (Test-Path $cliJs)) {
            $cliJs = Join-Path $ProjectDir 'node_modules\playwright-core\cli.js'
        }
        if (Test-Path $cliJs) {
            $rc = Invoke-Cmd "`"$nodeExe`" `"$cliJs`" install chromium"
        } else {
            $rc = 1
        }
    }

    if ($rc -ne 0) {
        Fail "Browser-Download fehlgeschlagen (Code $rc)."
        Write-Host ""
        Write-Host " Schnelle Loesung: Google Chrome installieren (kein Admin noetig):"
        Write-Host "   https://www.google.com/intl/de/chrome/?standalone=1"
        Write-Host " Dann setup.bat erneut starten."
        Read-Host "Taste druecken zum Beenden"
        exit 1
    }

    # Nach Download nochmals suchen
    if ($pwRevision -and (Test-Path $pwBrowserBase)) {
        $candidate = Join-Path $pwBrowserBase "chromium-$pwRevision\chrome-win\chrome.exe"
        if (Test-Path $candidate) { $useExePath = $candidate }
    }
    if (-not $useExePath -and (Test-Path $pwBrowserBase)) {
        $dirs = Get-ChildItem $pwBrowserBase -Directory |
                Where-Object { $_.Name -like 'chromium-*' } |
                Sort-Object Name -Descending
        foreach ($d in $dirs) {
            $candidate = Join-Path $d.FullName 'chrome-win\chrome.exe'
            if (Test-Path $candidate) { $useExePath = $candidate; break }
        }
    }
}

if (-not $useExePath) {
    Fail "Kein kompatibler Browser gefunden."
    Write-Host " Bitte Google Chrome installieren und setup.bat erneut starten."
    Write-Host "   https://www.google.com/intl/de/chrome/?standalone=1"
    Read-Host "Taste druecken zum Beenden"
    exit 1
}

# Pfad speichern - App und codegen.ps1 lesen browser-path.txt
[System.IO.File]::WriteAllText($browserPathTxt, $useExePath, [System.Text.Encoding]::UTF8)
Ok "Browser: $useExePath"

# =============================================================================
# 5) DESKTOP-VERKNUEPFUNG + AUTOSTART
# =============================================================================
Step 5 "Desktop-Verknuepfung & Autostart"

$shortcutsScript = Join-Path $ProjectDir 'scripts\install-shortcuts.ps1'
if (Test-Path $shortcutsScript) {
    & $shortcutsScript -Autostart
} else {
    Info "install-shortcuts.ps1 nicht gefunden – bitte manuell ausfuehren."
}

# =============================================================================
# FERTIG
# =============================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Alle Abhaengigkeiten bereit!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host " App starten: Doppelklick auf 'OP ePaper Tool' auf dem Desktop"
Write-Host " Oder:        start.bat"
Write-Host ""
