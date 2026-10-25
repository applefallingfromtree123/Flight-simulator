@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SkyLine Flight Simulator
where npm >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js가 필요합니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo 처음 실행: 필요한 파일을 설치합니다 ^(1~2분^)...
  call npm install
)
echo 빌드 후 브라우저를 엽니다. 이 창을 닫으면 게임 서버가 종료됩니다.
call npm start
pause
