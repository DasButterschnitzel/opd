# =============================================================================
#  OP ePaper Tool - Desktop-Verknuepfung + Autostart
#  Kein Admin noetig.
# =============================================================================

param(
    [switch]$Autostart,   # Auch Autostart-Verknuepfung anlegen
    [switch]$RemoveOnly   # Nur bestehende Verknuepfungen entfernen
)

$ProjectDir  = Split-Path -Parent $PSScriptRoot
$ElectronExe = Join-Path $ProjectDir 'node_modules\electron\dist\electron.exe'
$IconFile    = Join-Path $ProjectDir 'assets\icon.ico'
$AppTitle    = 'OP ePaper Tool'
$StartupDir  = [Environment]::GetFolderPath('Startup')
$DesktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppTitle.lnk"
$StartupLink = Join-Path $StartupDir "$AppTitle.lnk"

function Write-Ok($t)   { Write-Host "[OK] $t" -ForegroundColor Green }
function Write-Info($t) { Write-Host "     $t" }
function Write-Fail($t) { Write-Host "[FEHLER] $t" -ForegroundColor Red }

if ($RemoveOnly) {
    foreach ($lnk in @($DesktopLink, $StartupLink)) {
        if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Info "Entfernt: $lnk" }
    }
    exit 0
}

if (-not (Test-Path $ElectronExe)) {
    Write-Fail "Electron nicht gefunden: $ElectronExe"
    Write-Info  "Bitte zuerst setup.bat ausfuehren."
    exit 1
}

$IconArg = if (Test-Path $IconFile) { $IconFile } else { "$ElectronExe,0" }
$Shell = New-Object -ComObject WScript.Shell

# --- Desktop-Verknuepfung ---
try {
    $lnk = $Shell.CreateShortcut($DesktopLink)
    $lnk.TargetPath     = $ElectronExe
    $lnk.Arguments      = '.'
    $lnk.WorkingDirectory = $ProjectDir
    $lnk.Description    = "$AppTitle – Dreieich"
    $lnk.IconLocation   = $IconArg
    $lnk.Save()
    Write-Ok "Desktop-Verknuepfung: $DesktopLink"
} catch {
    Write-Fail "Desktop-Verknuepfung fehlgeschlagen: $($_.Exception.Message)"
}

# --- Autostart-Verknuepfung (startet minimiert im Tray) ---
if ($Autostart) {
    try {
        $lnk = $Shell.CreateShortcut($StartupLink)
        $lnk.TargetPath      = $ElectronExe
        $lnk.Arguments       = '. --start-hidden'
        $lnk.WorkingDirectory = $ProjectDir
        $lnk.Description     = "$AppTitle – Autostart"
        $lnk.IconLocation    = $IconArg
        $lnk.WindowStyle     = 7  # minimiert
        $lnk.Save()
        Write-Ok "Autostart-Verknuepfung: $StartupLink"
    } catch {
        Write-Fail "Autostart-Verknuepfung fehlgeschlagen: $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "Fertig. App per Doppelklick auf dem Desktop starten." -ForegroundColor Green
