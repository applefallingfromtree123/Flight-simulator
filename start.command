#!/bin/bash
# macOS / Linux launcher: double-click (macOS) or run ./start.command
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  echo "[!] Node.js가 필요합니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  (open https://nodejs.org 2>/dev/null || xdg-open https://nodejs.org 2>/dev/null) &
  read -r -p "Enter 키를 누르면 종료합니다."
  exit 1
fi
[ -d node_modules ] || { echo "처음 실행: 필요한 파일을 설치합니다 (1~2분)..."; npm install; }
echo "빌드 후 브라우저를 엽니다. 이 창을 닫으면 게임 서버가 종료됩니다."
npm start
