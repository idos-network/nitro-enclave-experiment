#!/bin/ash
# shellcheck shell=dash
set -u
set -e
set -o pipefail

# Go to app dir
cd /app

# Configure minimal S3 networking setup to get vsock.json and config.env
S3_SECRETS_BUCKET=$(cat ./s3_secrets_bucket.txt)

# Script dir for sourcing shared scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/shared/basic.ash"
configure_basic_networking "$S3_SECRETS_BUCKET"

# Get vsock.json for enclave networking
aws s3 cp "s3://$S3_SECRETS_BUCKET/entropy/vsock.json" ./vsock.json --region eu-west-1
source "$SCRIPT_DIR/shared/vsock.ash"
setup_vsock_networking "./vsock.json"

# Get config.env and source it
aws s3 cp "s3://$S3_SECRETS_BUCKET/entropy/config.env" ./config.env --region eu-west-1
source ./config.env

if true; then #SSH#
  source "$SCRIPT_DIR/shared/ssh.ash"
  setup_ssh "$SSH_PUBLIC_KEY"
fi

# Replace env vars in env.ts
# TODO: Solve this in pm2
sed -i "s|INSERT MONGO URI HERE|$MONGO_URI|g" ./env.ts
sed -i "s|INSERT KMS FLE ARN HERE|$KMS_FLE_ARN|g" ./env.ts
sed -i "s|INSERT AWS REGION HERE|$AWS_REGION|g" ./env.ts

# Add mongo host to /etc/hosts
# TODO: Solve this in configuration
echo "127.0.0.1 $(echo "$MONGO_HOST" | sed 's#-cluster.cluster-#-cluster.#')" | tee -a /etc/hosts

# NBD
source "$SCRIPT_DIR/shared/nbd.ash"
setup_nbd

echo "Fetching Caddyfile from S3"
CADDYFILE=Caddyfile
aws s3 cp "s3://$S3_SECRETS_BUCKET/entropy/$CADDYFILE" "./$CADDYFILE" --region eu-west-1
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
