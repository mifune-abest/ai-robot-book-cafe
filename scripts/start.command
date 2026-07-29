#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
  echo ".env を読み込みました（値は表示しません）。"
fi

if [[ -z "${TLS_CERT_PATH:-}" && -z "${TLS_KEY_PATH:-}" && \
      -f "$PROJECT_DIR/certs/server.pem" && -f "$PROJECT_DIR/certs/server-key.pem" ]]; then
  export TLS_CERT_PATH="$PROJECT_DIR/certs/server.pem"
  export TLS_KEY_PATH="$PROJECT_DIR/certs/server-key.pem"
fi

if [[ -n "${TLS_CERT_PATH:-}" || -n "${TLS_KEY_PATH:-}" ]]; then
  if [[ -z "${TLS_CERT_PATH:-}" || -z "${TLS_KEY_PATH:-}" || \
        ! -f "$TLS_CERT_PATH" || ! -f "$TLS_KEY_PATH" ]]; then
    echo "HTTPSの証明書と秘密鍵を両方正しく設定してください。"
    exit 1
  fi
  if ! openssl x509 -checkend 86400 -noout -in "$TLS_CERT_PATH" >/dev/null; then
    echo "HTTPS証明書が失効済み、または24時間以内に失効します。起動しません。"
    exit 1
  fi
  CERT_PUBLIC="$(openssl x509 -in "$TLS_CERT_PATH" -pubkey -noout)"
  KEY_PUBLIC="$(openssl pkey -in "$TLS_KEY_PATH" -pubout 2>/dev/null)"
  if [[ "$CERT_PUBLIC" != "$KEY_PUBLIC" ]]; then
    echo "HTTPS証明書と秘密鍵が一致しません。起動しません。"
    exit 1
  fi
  echo "HTTPS証明書ファイルを確認しました。各PCの信頼設定は前日リハーサルで別途確認が必要です。"
else
  echo "注意: HTTPS証明書がありません。HTTPは試作確認用で、LAN経由の写真は送信できません。"
fi

mkdir -p "$PROJECT_DIR/logs"
LOG_FILE="$PROJECT_DIR/logs/server-$(date +%Y%m%d-%H%M%S).log"
echo "ログ: $LOG_FILE"

exec > >(tee "$LOG_FILE") 2>&1

node scripts/preflight.mjs

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i -w $$ >/dev/null 2>&1 &
fi

exec node src/server.js
