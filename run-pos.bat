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

:: Start Cloudflare Tunnel in a new window
echo Starting Tunnel...
start "Cloudflare Tunnel" cmd /c "scripts\start-tunnel.bat"

:: Run Browser and Monitor Automation
echo.
echo Running Startup Automation (Browsers and Monitors)...
python scripts\startup_automation.py

echo.
echo Both services are starting in background windows.
echo monitor.sattavath.store should be live shortly.
echo.
pause
