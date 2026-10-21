@echo off
echo ==========================================
echo   POS SYSTEM AUTO-START (PRODUCTION)
echo ==========================================
:: Back up the database before anything opens it. Nothing is running yet, so
:: the copy is clean and there are no WAL sidecars to chase. A failed backup
:: must never stop the till from opening, hence no error check.
echo Backing up database...
powershell -ExecutionPolicy Bypass -File scripts\backup.ps1


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
