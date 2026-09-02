# =============================================================
# install-backup-task.ps1 - register the two-hourly POS backup
# Run ONCE on the till, from the project root:
#   powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1
# Re-running is safe; it overwrites the existing task.
# =============================================================

$ErrorActionPreference = "Stop"

$TaskName = "POS Database Backup"
$Script   = Join-Path (Get-Item $PSScriptRoot).FullName "backup.ps1"

if (-not (Test-Path $Script)) { throw "backup.ps1 not found next to this script." }

# -DbOnly skips the 12 MB of menu photos; those ride along with the full backup
# that run-pos.bat takes at open. backup.ps1 exits early when the database has
# not changed, so a two-hourly schedule needs no trading-hours window.
$Action = "powershell -ExecutionPolicy Bypass -File `"$Script`" -DbOnly"

schtasks /Create /TN $TaskName /SC HOURLY /MO 2 /TR $Action /F
if ($LASTEXITCODE -ne 0) { throw "schtasks failed with exit code $LASTEXITCODE" }

Write-Host ""
Write-Host "Registered '$TaskName' - every 2 hours." -ForegroundColor Green
Write-Host "  test now:  schtasks /Run /TN `"$TaskName`"" -ForegroundColor Gray
Write-Host "  remove:    schtasks /Delete /TN `"$TaskName`" /F" -ForegroundColor Gray
