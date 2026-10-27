#!/bin/zsh -l
set -e
cd -- "$(dirname -- "$0")"

if ! command -v npm >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1; then
  print 'Для первого запуска установите Node.js: https://nodejs.org/'
  read '?Нажмите Enter, чтобы закрыть окно.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print 'Первый запуск: устанавливаем зависимости. Сейчас нужен интернет.'
  npm install --no-audit --no-fund
fi
print ''
print 'СВОЯ ИГРА'
print 'После запуска откройте в Chrome: http://127.0.0.1:4173/host'
print 'Оставьте это окно открытым на время игры. Для остановки нажмите Control+C.'
print ''
npm start
