# =============================================================
# backup.ps1 - Back up the POS SQLite database + uploaded images
# Run manually, from START-POS.bat, or via Windows Task Scheduler (daily).
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
# Keeps the most recent $KeepCount backups under <root>\backups\.
# =============================================================

param(
    # Periodic runs pass -DbOnly: the database is 1.8 MB and changes constantly,
    # the 12 MB of menu photos change maybe monthly. Skipping them makes a
    # frequent backup essentially free.
    [switch]$DbOnly
)

$ErrorActionPreference = "Stop"

# Project root = parent of this scripts\ folder
$ProjectRoot = (Get-Item $PSScriptRoot).Parent.FullName
# prisma\dev.db, not the root: DATABASE_URL="file:./dev.db" is relative to
# schema.prisma, so the database lives next to it. This said <root>\dev.db and
# so never backed anything up - every run printed "not found" and exited, and
# run-pos.bat carried on regardless.
$DbPath      = Join-Path $ProjectRoot "prisma\dev.db"
$UploadsDir  = Join-Path $ProjectRoot "public\uploads"
$BackupRoot  = Join-Path $ProjectRoot "backups"
$KeepDays    = 14

if (-not (Test-Path $DbPath)) {
    Write-Host "dev.db not found at $DbPath - nothing to back up." -ForegroundColor Yellow
    exit 1
}

# Skip if nothing has been written since the last backup. Under WAL the main
# .db file sits untouched between checkpoints, so the -wal timestamp is the one
# that actually moves during trading. This makes overnight and closed-day runs
# free, so the schedule needs no trading-hours window.
$lastWrite = (Get-Item $DbPath).LastWriteTime
$walFile   = "$DbPath-wal"
if (Test-Path $walFile) {
    $walWrite = (Get-Item $walFile).LastWriteTime
    if ($walWrite -gt $lastWrite) { $lastWrite = $walWrite }
}
$newest = Get-ChildItem -Path $BackupRoot -Directory -ErrorAction SilentlyContinue |
          Sort-Object Name -Descending | Select-Object -First 1
if ($newest -and $newest.CreationTime -gt $lastWrite) {
    Write-Host "No database changes since $($newest.Name) - skipping." -ForegroundColor DarkGray
    exit 0
}

$stamp     = Get-Date -Format "yyyy-MM-dd_HHmmss"
$DestDir   = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

# Fold the WAL into the main DB file first so the copy is self-contained.
# If sqlite3 isn't installed we fall back to copying the -wal/-shm sidecars.
$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
$checkpointed = $false
if ($sqlite) {
    try {
        & sqlite3 $DbPath "PRAGMA wal_checkpoint(TRUNCATE);" | Out-Null
        $checkpointed = $true
    } catch {
        Write-Host "WAL checkpoint failed; will copy sidecar files instead." -ForegroundColor Yellow
    }
}

Copy-Item -Force $DbPath (Join-Path $DestDir "dev.db")
if (-not $checkpointed) {
    foreach ($suffix in @("-wal", "-shm")) {
        $side = "$DbPath$suffix"
        if (Test-Path $side) { Copy-Item -Force $side (Join-Path $DestDir ("dev.db" + $suffix)) }
    }
}

# Uploaded menu/customer images (full backups only)
if (-not $DbOnly -and (Test-Path $UploadsDir)) {
    Copy-Item -Recurse -Force $UploadsDir (Join-Path $DestDir "uploads")
}

Write-Host "Backup written to $DestDir" -ForegroundColor Green

# Prune old backups, keep the newest $KeepCount
# Prune by AGE, not by count: on a two-hourly schedule "keep the last 14" would
# mean barely two days of history.
$cutoff = (Get-Date).AddDays(-$KeepDays).ToString("yyyy-MM-dd")
Get-ChildItem -Path $BackupRoot -Directory | Where-Object { $_.Name -lt $cutoff } | ForEach-Object {
    Remove-Item -Recurse -Force $_.FullName
    Write-Host "Pruned old backup: $($_.Name)" -ForegroundColor DarkGray
}
