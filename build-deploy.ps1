# =============================================================
# build-deploy.ps1 — Build & package the POS system for deployment
# Run from project root: .\build-deploy.ps1
# Output: ..\deploy-pos\  (sibling folder, ready to zip & ship)
# =============================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = (Get-Item $PSScriptRoot).FullName
$DeployDir = (Get-Item (Join-Path $ProjectRoot "..\deploy-pos") -ErrorAction SilentlyContinue).FullName
if (-not $DeployDir) {
    # If it doesn't exist yet, we can't Get-Item on it, so just construct the path
    $DeployDir = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot "..\deploy-pos"))
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  POS BUILD + DEPLOY PACKAGER" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Clean old deploy folder
if (Test-Path $DeployDir) {
    Write-Host "Removing old deploy-pos folder..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $DeployDir
}
New-Item -ItemType Directory -Path $DeployDir | Out-Null
Write-Host "Created fresh deploy-pos folder" -ForegroundColor Green

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
Write-Host "Copying standalone server to deploy-pos..." -ForegroundColor Cyan
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

# Step 6: Copy prisma schema + seed file
Write-Host "Copying prisma files..." -ForegroundColor Cyan
$PrismaDest = Join-Path $DeployDir "prisma"
New-Item -ItemType Directory -Force -Path $PrismaDest | Out-Null
Copy-Item -Force (Join-Path $ProjectRoot "prisma\schema.prisma") $PrismaDest
Copy-Item -Force (Join-Path $ProjectRoot "prisma\seedDeployData.js") $PrismaDest

# Step 7: Copy the SQLite database
Write-Host "Copying dev.db..." -ForegroundColor Cyan
Copy-Item -Force (Join-Path $ProjectRoot "dev.db") $DeployDir

# Step 8: Copy .env file
Write-Host "Copying .env..." -ForegroundColor Cyan
Copy-Item -Force (Join-Path $ProjectRoot ".env") $DeployDir

# Step 9: Copy scripts folder + startup files
Write-Host "Copying scripts and startup files..." -ForegroundColor Cyan
Copy-Item -Recurse -Force (Join-Path $ProjectRoot "scripts") (Join-Path $DeployDir "scripts")
Copy-Item -Force (Join-Path $ProjectRoot "run-pos.bat") $DeployDir

# Overwrite start-pos.bat in deploy to use "node server.js" instead of "npm run start"
$startPosScript = "node server.js`r`n"
$startPosScriptFull = "@echo off`r`n" +
"echo Starting POS Production Server...`r`n" +
"cd /d `"%~dp0..`"`r`n" +
"node server.js`r`n" +
"pause`r`n"
[System.IO.File]::WriteAllText((Join-Path $DeployDir "scripts\start-pos.bat"), $startPosScriptFull)

# Step 10: Copy node_modules needed for seed (bcryptjs, prisma, date-fns)
Write-Host "Copying node_modules for seeding..." -ForegroundColor Cyan
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

# Step 11: Write START-POS.bat
Write-Host "Creating START-POS.bat..." -ForegroundColor Cyan
$startPosContent = "@echo off`r`n" +
"echo ==========================================`r`n" +
"echo   MEMORIES LANE POS - STARTING UP`r`n" +
"echo ==========================================`r`n" +
"echo.`r`n" +
"echo Starting POS Server...`r`n" +
"start `"POS Server`" cmd /c `"node server.js`"`r`n" +
"timeout /t 8 /nobreak > nul`r`n" +
"if exist scripts\start-tunnel.bat (`r`n" +
"    echo Starting Tunnel...`r`n" +
"    start `"Cloudflare Tunnel`" cmd /c `"scripts\start-tunnel.bat`"`r`n" +
"    timeout /t 5 /nobreak > nul`r`n" +
")`r`n" +
"if exist scripts\startup_automation.py (`r`n" +
"    python scripts\startup_automation.py`r`n" +
") else (`r`n" +
"    start http://localhost:3000/pos`r`n" +
")`r`n" +
"echo.`r`n" +
"echo POS is running at http://localhost:3000`r`n" +
"echo.`r`n" +
"pause`r`n"
[System.IO.File]::WriteAllText((Join-Path $DeployDir "START-POS.bat"), $startPosContent)

# Step 12: Write FIRST-TIME-SETUP.bat
Write-Host "Creating FIRST-TIME-SETUP.bat..." -ForegroundColor Cyan
$setupContent = "@echo off`r`n" +
"echo ==========================================`r`n" +
"echo   FIRST TIME SETUP - SEEDING DATABASE`r`n" +
"echo ==========================================`r`n" +
"echo.`r`n" +
"echo This will wipe and re-seed the database.`r`n" +
"echo.`r`n" +
"set /p confirm=Are you sure? Type YES to continue: `r`n" +
"if /i `"%confirm%`" NEQ `"YES`" (`r`n" +
"    echo Aborted.`r`n" +
"    pause`r`n" +
"    exit /b`r`n" +
")`r`n" +
"echo.`r`n" +
"echo Running seed...`r`n" +
"node prisma\seedDeployData.js`r`n" +
"echo.`r`n" +
"echo Done! You can now run START-POS.bat`r`n" +
"pause`r`n"
[System.IO.File]::WriteAllText((Join-Path $DeployDir "FIRST-TIME-SETUP.bat"), $setupContent)

# Done
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  DEPLOY PACKAGE READY!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Output: $DeployDir" -ForegroundColor White
Write-Host ""
Write-Host "  On the POS machine:" -ForegroundColor Yellow
Write-Host "  1. Copy/unzip deploy-pos anywhere" -ForegroundColor White
Write-Host "  2. First time only: run FIRST-TIME-SETUP.bat" -ForegroundColor White
Write-Host "  3. Daily use: run START-POS.bat" -ForegroundColor White
Write-Host ""
