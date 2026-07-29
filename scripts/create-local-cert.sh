#!/bin/zsh
set -eu

if [[ $# -ne 1 ]]; then
  echo "使い方: ./scripts/create-local-cert.sh 192.168.x.x"
  echo "ホストPCの固定LAN IPを1つ指定してください。"
  exit 1
fi

LAN_IP="$1"
if [[ ! "$LAN_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "IPアドレスの形が正しくありません。"
  exit 1
fi
for OCTET in ${(s:.:)LAN_IP}; do
  if (( 10#$OCTET > 255 )); then
    echo "IPアドレスの各数字は0〜255にしてください。"
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$PROJECT_DIR/certs"
mkdir -p "$CERT_DIR"
umask 077

if [[ -e "$CERT_DIR/rootCA-key.pem" || -e "$CERT_DIR/server-key.pem" ]]; then
  echo "既存の秘密鍵があります。上書きしません: $CERT_DIR"
  exit 1
fi

openssl genrsa -out "$CERT_DIR/rootCA-key.pem" 4096
openssl req -x509 -new -nodes -key "$CERT_DIR/rootCA-key.pem" -sha256 -days 14 \
  -out "$CERT_DIR/rootCA.pem" -subj "/CN=AI ROBOT BOOK CAFE Event CA"

openssl genrsa -out "$CERT_DIR/server-key.pem" 2048
openssl req -new -key "$CERT_DIR/server-key.pem" -out "$CERT_DIR/server.csr" \
  -subj "/CN=$LAN_IP"

cat > "$CERT_DIR/server.ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
IP.1=$LAN_IP
IP.2=127.0.0.1
DNS.1=localhost
EOF

openssl x509 -req -in "$CERT_DIR/server.csr" -CA "$CERT_DIR/rootCA.pem" \
  -CAkey "$CERT_DIR/rootCA-key.pem" -CAcreateserial -out "$CERT_DIR/server.pem" \
  -days 7 -sha256 -extfile "$CERT_DIR/server.ext"

echo "証明書を作成しました: $CERT_DIR"
echo "重要: rootCA-key.pem はこのPCの外へ出さないでください。"
echo "rootCA.pem を4台の信頼ストアへ入れる作業は、端末管理者の明示許可後に行ってください。"
