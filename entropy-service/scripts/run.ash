#!/bin/bash
set -ueo pipefail

# Incoming
socat VSOCK-LISTEN:5006,fork TCP4-CONNECT:127.0.0.1:80 &
socat VSOCK-LISTEN:5007,fork TCP4-CONNECT:127.0.0.1:443 &

# Outgoing (mongo)
socat TCP4-LISTEN:27017,fork VSOCK-CONNECT:3:6006 &

# Outgoing (AWS identity - iptables)
socat TCP4-LISTEN:80,fork,bind=127.0.0.2 VSOCK-CONNECT:3:6008 &

# Outgoing (AWS kms)
socat TCP4-LISTEN:443,fork,bind=127.0.0.3 VSOCK-CONNECT:3:6009 &

# Outgoing (AWS s3 for secrets)
socat TCP4-LISTEN:443,fork,bind=127.0.0.4 VSOCK-CONNECT:3:6010 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.5 VSOCK-CONNECT:3:6011 &

# Outgoing (let's encrypt acme lookup)
socat TCP4-LISTEN:443,fork,bind=127.0.0.6 VSOCK-CONNECT:3:6012 &

# Outgoing (agent)
socat TCP4-LISTEN:7001,fork,bind=127.0.0.7 VSOCK-CONNECT:3:7001 &

cd /app

S3_SECRETS_BUCKET=$(cat ./s3_secrets_bucket.txt)
echo "Fetching mongo connection string from secrets"
aws s3 cp "s3://$S3_SECRETS_BUCKET/mongodb_uri.txt" ./mongodb_uri.txt --region eu-west-1
if [ ! -f ./mongodb_uri.txt ]; then
  echo "Couldn't download mongodb_uri.txt from S3, exiting"
  exit 1
fi

MONGO_URI="$(cat ./mongodb_uri.txt)"
sed -i "s#export const MONGO_URI = \"INSERT YOUR MONGO URL HERE\";#export const MONGO_URI = \"${MONGO_URI//&/\\&}\";#" ./env.ts

echo "Fetching hostname from S3"
HOSTNAME_FILE=host.txt
aws s3 cp "s3://$S3_SECRETS_BUCKET/$HOSTNAME_FILE" "./$HOSTNAME_FILE" --region eu-west-1
if [ ! -f "./$HOSTNAME_FILE" ]; then
  echo "Couldn't download $HOSTNAME_FILE from S3, exiting"
  exit 1
fi
HOST=$(cat ./$HOSTNAME_FILE)
sed -i "s#export const HOST = \"INSERT YOUR HOST HERE\";#export const HOST = \"${HOST//&/\\&}\";#" ./env.ts

echo "Fetching Caddyfile from S3"
CADDYFILE=Caddyfile
aws s3 cp "s3://$S3_SECRETS_BUCKET/$CADDYFILE-entropy" "./$CADDYFILE" --region eu-west-1
if [ ! -f "./$CADDYFILE" ]; then
  echo "Couldn't download $CADDYFILE from S3, exiting"
  exit 1
fi

echo "Fetching JWT token secret from S3"

JWT_TOKEN_PUBLIC_FILE=jwt_token_public.pem
aws s3 cp "s3://$S3_SECRETS_BUCKET/$JWT_TOKEN_PUBLIC_FILE" "./$JWT_TOKEN_PUBLIC_FILE" --region eu-west-1
if [ ! -f "./$JWT_TOKEN_PUBLIC_FILE" ]; then
  echo "Couldn't download $JWT_TOKEN_PUBLIC_FILE from S3..."
  exit 1
fi

echo "Running service"
export HOME=/app
pm2-runtime ecosystem.config.cjs
