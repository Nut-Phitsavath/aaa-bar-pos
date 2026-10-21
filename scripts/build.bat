@echo off
:: After every git pull, with the POS stopped (npm ci replaces node_modules,
:: which the running server holds open).
:: npm ci, not npm install: it installs exactly package-lock.json and never
:: rewrites it, so the till's checkout stays clean and the next git pull works.
:: "call": without it a batch file ends when npm does.
cd /d "%~dp0.."
echo Installing packages...
call npm ci
if errorlevel 1 goto failed
echo Starting Production Build...
call npm run build
if errorlevel 1 goto failed
echo Build Complete! Start the POS with run-pos.bat or npm run start.
pause
exit /b 0

:failed
echo.
echo FAILED - see the messages above. Fix the problem and run this again
echo before starting the POS.
pause
exit /b 1
