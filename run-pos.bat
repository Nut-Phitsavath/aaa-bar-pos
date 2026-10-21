@echo off
:: From a Startup-folder shortcut the working folder is not always this one.
cd /d "%~dp0"
echo ==========================================
echo   POS SYSTEM AUTO-START (PRODUCTION)
echo ==========================================
:: Back up the database before anything opens it. Nothing is running yet, so
:: the copy is clean and there are no WAL sidecars to chase. A failed backup
:: must never stop the till from opening, hence no error check.
echo Backing up database...
powershell -ExecutionPolicy Bypass -File scripts\backup.ps1

:: Bring the database up to this version of the app. Most days there is
:: nothing to do; after an update it applies the new migrations, right after
:: the backup above. If it fails the till does not open: the new code on the
:: old database would fail at the first order instead, in the middle of service.
echo Updating database...
node node_modules\prisma\build\index.js migrate deploy
if errorlevel 1 (
    echo.
    echo The database update FAILED - the POS was not started.
    echo New till? Run FIRST-TIME-SETUP.bat first.
    echo Otherwise the database is backed up in the backups folder - call support.
    pause
    exit /b 1
)

:: Start POS Server in a new window
echo Starting Server...
start "POS Server" cmd /c "scripts\start-pos.bat"

:: Wait 10 seconds for server to initialize
timeout /t 10 /nobreak > nul

:: No Cloudflare tunnel: that was the cafe's remote view, and this bar runs on
:: its own LAN only. Starting one would publish the till to the internet.

:: Run Browser and Monitor Automation
echo.
echo Running Startup Automation (Browsers and Monitors)...
python scripts\startup_automation.py

echo.
echo The POS server is starting in a background window.
echo.
pause
