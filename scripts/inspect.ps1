# Portal-Inspektor - dumpt DOM-Struktur fuer Selektor-Diagnose.
# Aufruf: inspect.bat  (fragt interaktiv nach E-Mail und Passwort)

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
    Write-Host "[FEHLER] Node.js nicht gefunden." -ForegroundColor Red; exit 1
}
$env:Path = "$nodeDir;" + $env:Path
$nodeExe  = Join-Path $nodeDir 'node.exe'

if (-not (Test-Path (Join-Path $ProjectDir 'browser-path.txt'))) {
    Write-Host "[FEHLER] browser-path.txt fehlt. Bitte setup.bat ausfuehren." -ForegroundColor Red; exit 1
}

Write-Host ""
Write-Host "Portal-Inspektor" -ForegroundColor Cyan
Write-Host "Bitte Zugangsdaten eingeben (werden nur fuer diese Sitzung verwendet):"
Write-Host ""
$email    = Read-Host "E-Mail"
$passwort = Read-Host "Passwort"

Write-Host ""
Write-Host "Starte Inspektion (Browser-Fenster wird geoeffnet)..." -ForegroundColor Cyan
Write-Host ""

& $nodeExe (Join-Path $ProjectDir 'scripts\inspect-portal.js') $email $passwort

Write-Host ""
Write-Host "Fertig. Bitte Inhalte aus debug\ an den Entwickler weitergeben." -ForegroundColor Green
