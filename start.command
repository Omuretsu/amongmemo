#!/bin/zsh
set -e

SCRIPT_DIR=${0:A:h}
cd "$SCRIPT_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.jsが見つかりません。HomebrewなどでNode.jsをインストールしてください。"
  read -k 1 "?何かキーを押すと終了します。"
  exit 1
fi

HEALTH_RESPONSE=$(curl --silent --fail http://127.0.0.1:3210/api/health 2>/dev/null || true)
if [[ "$HEALTH_RESPONSE" == *'"apiVersion":2'* ]]; then
  open -a Safari http://127.0.0.1:3210
  exit 0
fi

if [[ -n "$HEALTH_RESPONSE" ]]; then
  echo "旧バージョンのAmong Memoサーバーが起動中です。"
  echo "以前のターミナルでControl+Cを押して終了してから、もう一度start.commandを実行してください。"
  read -k 1 "?何かキーを押すと終了します。"
  exit 1
fi

node server.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' INT TERM EXIT

for i in {1..50}; do
  if curl --silent --fail http://127.0.0.1:3210/api/health >/dev/null; then
    open -a Safari http://127.0.0.1:3210
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.1
done

echo "Among Memoサーバーを起動できませんでした。"
exit 1
