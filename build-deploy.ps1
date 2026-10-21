# =============================================================
# build-deploy.ps1 — Build & package the POS system for deployment
# Run from project root: .\build-deploy.ps1
# Output: ..\deploy-bar-pos\  (sibling folder, ready to zip & ship)
#
# The package holds the app and nothing of the till's: no database, no
# uploaded photos, no .env. So it can be copied over a running till's folder
# (UPDATE-POS.bat) and the bar's sales, photos and secrets stay where they are.
# =============================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = (Get-Item $PSScriptRoot).FullName
# deploy-bar-pos, not deploy-pos: ..\deploy-pos is the cafe project's package,
# and Step 1 below deleted it on every build of this one.
$DeployDir = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot "..\deploy-bar-pos"))

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  POS BUILD + DEPLOY PACKAGER" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Clean old deploy folder - unless a till has been run from it, in
# which case it holds a database that is not ours to delete.
if (Test-Path $DeployDir) {
    if (Test-Path (Join-Path $DeployDir "prisma\dev.db")) {
        Write-Host "$DeployDir has a database in it (prisma\dev.db) - the POS was run from this folder." -ForegroundColor Red
        Write-Host "Move that folder somewhere safe (or delete it yourself), then build again." -ForegroundColor Red
        exit 1
    }
    Write-Host "Removing old deploy-bar-pos folder..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $DeployDir
}
New-Item -ItemType Directory -Path $DeployDir | Out-Null
Write-Host "Created fresh deploy-bar-pos folder" -ForegroundColor Green

# Step 2: Run next build
Write-Host ""
Write-Host "Running next build (standalone)..." -ForegroundColor Cyan
Set-Location $ProjectRoot
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Aborting." -ForegroundColor Red
    exit 1
}
Write-Host "Build succeeded!" -ForegroundColor Green

# Step 3: Copy standalone server output
Write-Host ""
Write-Host "Copying standalone server to deploy-bar-pos..." -ForegroundColor Cyan
$StandaloneDir = Join-Path $ProjectRoot ".next\standalone"
Copy-Item -Recurse -Force "$StandaloneDir\*" $DeployDir

# Next.js standalone often nests the project in a deep subfolder. 
# We find where server.js is and move everything from that folder up to the root.
$ServerFile = Get-ChildItem -Path $DeployDir -Filter "server.js" -Recurse | Select-Object -First 1
if ($ServerFile) {
    $ServerDir = (Get-Item $ServerFile.Directory.FullName).FullName
    $NormalizedDeployDir = (Get-Item $DeployDir).FullName
    if ($ServerDir -ne $NormalizedDeployDir) {
        Write-Host "   Found server.js at: $($ServerFile.FullName)" -ForegroundColor Gray
        Write-Host "   Flattening project structure..." -ForegroundColor Gray
        Copy-Item -Path "$ServerDir\*" -Destination $DeployDir -Recurse -Force
        # We don't remove the nested folders just in case they are needed for resolution, 
        # but the main files are now at the root.
    } else {
        Write-Host "   server.js is already at the root. No flattening needed." -ForegroundColor Gray
    }
} else {
    Write-Host "⚠  Warning: server.js not found in .next/standalone output!" -ForegroundColor Yellow
}

# Step 4: Copy public assets folder
Write-Host "Copying public/ assets..." -ForegroundColor Cyan
Copy-Item -Recurse -Force (Join-Path $ProjectRoot "public") (Join-Path $DeployDir "public")

# Step 5: Copy .next/static (CSS/JS chunks)
Write-Host "Copying .next/static..." -ForegroundColor Cyan
$StaticDest = Join-Path $DeployDir ".next\static"
New-Item -ItemType Directory -Force -Path $StaticDest | Out-Null
Copy-Item -Recurse -Force (Join-Path $ProjectRoot ".next\static\*") $StaticDest

# Step 6: The schema, the migrations that build the database and bring it up
# to date, and first-time setup. No seed and no database: the till starts
# empty and FIRST-TIME-SETUP.bat builds it there (seedDeployData.js, which
# this used to copy, no longer exists).
Write-Host "Copying prisma files..." -ForegroundColor Cyan
$PrismaDest = Join-Path $DeployDir "prisma"
New-Item -ItemType Directory -Force -Path $PrismaDest | Out-Null
Copy-Item -Force (Join-Path $ProjectRoot "prisma\schema.prisma") $PrismaDest
Copy-Item -Recurse -Force (Join-Path $ProjectRoot "prisma\migrations") $PrismaDest
Copy-Item -Force (Join-Path $ProjectRoot "prisma\setupFirstInstall.js") $PrismaDest

# Steps 7 and 8 copied this machine's database and .env into the package. They
# are gone: the till's .env is written once, on the till, by FIRST-TIME-SETUP.bat
# (with a SESSION_SECRET of its own), and an update must never replace it - it
# will hold the OnePay keys too. Step 11b makes sure neither came in another way.

# Step 9: Copy scripts folder + startup files
Write-Host "Copying scripts and startup files..." -ForegroundColor Cyan
# scripts\* into scripts\, not scripts into scripts\: the standalone output
# already has a scripts\ (it traces backup.ps1, which the shifts route runs),
# and copying a folder onto an existing one nests it - so the package had
# scripts\scripts\startup_automation.py, where run-pos.bat never looked.
$ScriptsDest = Join-Path $DeployDir "scripts"
New-Item -ItemType Directory -Force -Path $ScriptsDest | Out-Null
Copy-Item -Recurse -Force (Join-Path $ProjectRoot "scripts\*") $ScriptsDest
Copy-Item -Force (Join-Path $ProjectRoot "run-pos.bat") $DeployDir

# Overwrite start-pos.bat in deploy to use "node server.js" instead of "npm run start"
$startPosScript = "node server.js`r`n"
$startPosScriptFull = "@echo off`r`n" +
"echo Starting POS Production Server...`r`n" +
"cd /d `"%~dp0..`"`r`n" +
"node server.js`r`n" +
"pause`r`n"
[System.IO.File]::WriteAllText((Join-Path $DeployDir "scripts\start-pos.bat"), $startPosScriptFull)

# Step 10: Copy node_modules the database tools need: the prisma CLI and its
# engines (migrate deploy, in run-pos.bat and FIRST-TIME-SETUP.bat) and bcryptjs
# (setupFirstInstall.js)
Write-Host "Copying node_modules for the database tools..." -ForegroundColor Cyan
$SeedModules = @("@prisma", "prisma", "bcryptjs", "date-fns", ".prisma")
$DestModules = Join-Path $DeployDir "node_modules"
New-Item -ItemType Directory -Force -Path $DestModules | Out-Null
foreach ($mod in $SeedModules) {
    $src = Join-Path $ProjectRoot "node_modules\$mod"
    if (Test-Path $src) {
        Copy-Item -Recurse -Force $src $DestModules
        Write-Host "   copied: $mod" -ForegroundColor DarkGreen
    }
}

# Batch files want CRLF whatever line endings this script was saved with.
function Write-Bat($name, $text) {
    [System.IO.File]::WriteAllText((Join-Path $DeployDir $name), ($text -replace "`r?`n", "`r`n"))
}

# Step 11: Write START-POS.bat. It is run-pos.bat (the Startup-folder shortcut's
# target), so the two cannot drift: back up, bring the database up to date, start.
# The old one here did neither, so an update would have run new code on the old
# database.
Write-Host "Creating START-POS.bat..." -ForegroundColor Cyan
Write-Bat "START-POS.bat" @'
@echo off
cd /d "%~dp0"
call "%~dp0run-pos.bat"
'@

# Step 11b: The package must hold none of the till's data, however it got in:
# Next's standalone output can carry .env along, and public\ held this
# machine's photos. UPDATE-POS.bat copies the package over a live till, so
# anything left here would land on the bar's own.
foreach ($data in @(".env", "prisma\dev.db", "prisma\dev.db-wal", "prisma\dev.db-shm", "dev.db", "public\uploads", "backups")) {
    $p = Join-Path $DeployDir $data
    if (Test-Path $p) {
        Remove-Item -Recurse -Force $p
        Write-Host "   left out of the package: $data" -ForegroundColor DarkGray
    }
}

# Step 12: Write FIRST-TIME-SETUP.bat. It used to "wipe and re-seed" on "type
# YES". Now it writes .env if there is none, builds the database with the
# migrations, and asks for the Owner PIN - and setupFirstInstall.js changes
# nothing on a till that already has sales.
Write-Host "Creating FIRST-TIME-SETUP.bat..." -ForegroundColor Cyan
Write-Bat "FIRST-TIME-SETUP.bat" @'
@echo off
cd /d "%~dp0"
echo ==========================================
echo   FIRST TIME SETUP
echo ==========================================
echo.
echo Builds the database and creates the Owner account.
echo On a till that already has sales it changes nothing.
echo.
if not exist .env (
    node -e "require('fs').writeFileSync('.env','DATABASE_URL=file:./dev.db\nSESSION_SECRET='+require('crypto').randomBytes(48).toString('base64url')+'\n')"
    echo Wrote .env, with this till's own login secret.
)
echo Building the database...
node node_modules\prisma\build\index.js migrate deploy
if errorlevel 1 (
    echo.
    echo Building the database FAILED - see the message above. Nothing else was done.
    pause
    exit /b 1
)
echo.
node prisma\setupFirstInstall.js
echo.
pause
'@

# Step 12b: Write UPDATE-POS.bat, run from a NEW package to update a till.
Write-Host "Creating UPDATE-POS.bat..." -ForegroundColor Cyan
Write-Bat "UPDATE-POS.bat" @'
@echo off
REM Updates the POS on this till from this package. Backs up the database,
REM stops the server, copies the new version over, then starts the POS.
REM Drag the till's POS folder onto this file, or answer the prompt.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-pos.ps1" -Install "%~1"
pause
'@

# Done
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  DEPLOY PACKAGE READY!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Output: $DeployDir" -ForegroundColor White
Write-Host ""
Write-Host "  New till:" -ForegroundColor Yellow
Write-Host "  1. Copy/unzip deploy-bar-pos to where the POS will live (e.g. C:\pos)" -ForegroundColor White
Write-Host "  2. Run FIRST-TIME-SETUP.bat there and choose the Owner PIN" -ForegroundColor White
Write-Host "  3. Daily use: run START-POS.bat" -ForegroundColor White
Write-Host ""
Write-Host "  Updating a till:" -ForegroundColor Yellow
Write-Host "  Copy this package onto the till anywhere EXCEPT its POS folder," -ForegroundColor White
Write-Host "  then drag the POS folder onto UPDATE-POS.bat in the package." -ForegroundColor White
Write-Host ""
