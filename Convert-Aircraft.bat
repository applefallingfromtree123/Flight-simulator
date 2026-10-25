@echo off
chcp 65001 >nul
rem Downloads FlightGear aircraft and converts them for SkyLine (needs Node.js 20+ and git).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js가 필요합니다: https://nodejs.org & pause & exit /b 1)
node tools\fgconv\convert.mjs %*
echo.
echo 완료. Unreal\SkyLine\SkyLine.uproject 를 여세요.
pause
