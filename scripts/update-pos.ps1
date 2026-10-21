# =============================================================
# update-pos.ps1 - copy this package over the till's POS folder, safely
#
# Run it FROM THE NEW PACKAGE, pointing at the till's POS folder:
#   powershell -ExecutionPolicy Bypass -File scripts\update-pos.ps1 C:\pos
# or drag the POS folder onto UPDATE-POS.bat next to it.
#
# Ported from the cafe project's package. The copy needs no exclusions:
# build-deploy.ps1 builds a package with no database, no photos and no .env,
# and this refuses one that has them, so nothing in it can land on the bar's
# data. What this adds is what goes wrong when the copy is done by hand:
#
#   - a backup is taken first
#   - the server is stopped first; a running one holds files open, and a
#     half-finished copy leaves a POS that will not start
#   - it refuses a folder that is not a POS install
#
# Uses robocopy /E, never /MIR. Mirror would delete anything not in the
# package - which is precisely the database, the photos and the .env.
#
# The database itself is brought up to the new version by START-POS.bat
# (migrate deploy), which this starts at the end.
# =============================================================

param(
    [string] $Install,
    # For trying it on the developer's machine: does not stop or start anything.
    [switch] $Rehearsal
)

$ErrorActionPreference = "Stop"
$Package = (Get-Item $PSScriptRoot).Parent.FullName

function Abort($msg, $after = "Nothing was copied. The POS folder is untouched.") {
    Write-Host ""
    Write-Host "STOPPED - $msg" -ForegroundColor Red
    Write-Host $after -ForegroundColor Red
    exit 2
}

Write-Host ""
Write-Host "=== POS UPDATE =============================================" -ForegroundColor Cyan
Write-Host "from : $Package"

# --- where are we updating? ----------------------------------------------
if (-not $Install) {
    Write-Host ""
    $Install = Read-Host "Full path to the POS folder on this till (e.g. C:\pos)"
}
$Install = $Install.Trim().Trim('"')
if (-not (Test-Path $Install)) { Abort "no such folder: $Install" }
$Install = (Get-Item $Install).FullName
Write-Host "to   : $Install"
Write-Host ""

# --- refuse anything that is not the shape we expect ----------------------
if ($Install -eq $Package) { Abort "that is the package itself, not the POS folder. Copy the package somewhere else first." }
if (-not (Test-Path (Join-Path $Package "START-POS.bat"))) { Abort "$Package is not a POS package." }
foreach ($data in @("prisma\dev.db", "public\uploads", ".env")) {
    if (Test-Path (Join-Path $Package $data)) { Abort "this package contains $data - it would overwrite the bar's own. Rebuild it with build-deploy.ps1." }
}
if (-not (Test-Path (Join-Path $Install "server.js"))) { Abort "$Install has no server.js, so it is not a POS install. Check the path." }

# --- back up before touching anything ------------------------------------
$Db = Join-Path $Install "prisma\dev.db"
$dbSizeBefore = $null
if (Test-Path $Db) {
    $stamp     = Get-Date -Format "yyyy-MM-dd_HHmmss"
    $BackupDir = Join-Path $Install "backups"
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $dest = Join-Path $BackupDir "pre-update_$stamp.db"
    Copy-Item -Force $Db $dest
    foreach ($side in @("-wal", "-shm")) {
        if (Test-Path "$Db$side") { Copy-Item -Force "$Db$side" "$dest$side" }
    }
    $dbSizeBefore = (Get-Item $Db).Length
    Write-Host "Backed up the database -> backups\pre-update_$stamp.db" -ForegroundColor Green
} else {
    Write-Host "No database yet - run FIRST-TIME-SETUP.bat in the POS folder after this." -ForegroundColor Yellow
}

# --- stop the POS, or the copy will half-fail on locked files -------------
if ($Rehearsal) {
    Write-Host "Rehearsal: not stopping anything." -ForegroundColor DarkGray
} else {
    # By the port it serves on, not by window title as the cafe's did: with
    # Windows Terminal as the console (Windows 11's default) the window is
    # Terminal's, "taskkill /FI WINDOWTITLE" finds nothing, and the old server
    # kept running - holding :3000, so the new one could not start.
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $server = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($server.CommandLine -notmatch 'server\.js') { Abort "port 3000 is in use by $($server.Name), not the POS server. Close it and run this again." }
        # The window around it (scripts\start-pos.bat) goes too, or it sits at "Press any key".
        $window = Get-CimInstance Win32_Process -Filter "ProcessId=$($server.ParentProcessId)" -ErrorAction SilentlyContinue
        $target = if ($window -and $window.CommandLine -match 'start-pos\.bat') { $window.ProcessId } else { $server.ProcessId }
        taskkill /PID $target /T /F | Out-Null
        Start-Sleep -Seconds 2
        if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { Abort "the POS server would not stop. Close the POS Server window and run this again." }
        Write-Host "Stopped the POS server." -ForegroundColor Green
    } else {
        Write-Host "The POS server was not running." -ForegroundColor DarkGray
    }
}

# --- the copy ------------------------------------------------------------
Write-Host "Copying files..." -ForegroundColor Cyan
& robocopy $Package $Install /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) {
    Write-Host "robocopy exit code $rc" -ForegroundColor Red
    Write-Host "Most likely a file was still open. Close the POS Server window and run this again." -ForegroundColor Yellow
    Write-Host "The database was backed up before the copy started; nothing in the package can overwrite it." -ForegroundColor Yellow
    exit 1
}
Write-Host "Files copied." -ForegroundColor Green

# --- the database must be exactly as we left it --------------------------
if ($null -ne $dbSizeBefore) {
    $restore = "The POS was not started. Restore prisma\dev.db from backups\pre-update_$stamp.db."
    if (-not (Test-Path $Db)) { Abort "the database is GONE after the copy." $restore }
    $after = (Get-Item $Db).Length
    if ($after -ne $dbSizeBefore) { Abort "the database changed size during the copy ($dbSizeBefore -> $after)." $restore }
    Write-Host "Database untouched ($after bytes)." -ForegroundColor Green
}

Write-Host ""
if ($Rehearsal) {
    Write-Host "=== UPDATE COMPLETE (rehearsal - not restarted) ============" -ForegroundColor Green
} else {
    Write-Host "=== UPDATE COMPLETE - starting the POS =====================" -ForegroundColor Green
    Start-Process -FilePath (Join-Path $Install "START-POS.bat") -WorkingDirectory $Install
    Write-Host ""
    Write-Host "Before serving customers: open Orders and check past orders are" -ForegroundColor White
    Write-Host "listed, and Menu to check the photos still load." -ForegroundColor White
}
exit 0
