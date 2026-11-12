#!/bin/ash
# shellcheck shell=dash
set -ueo pipefail

# Go to app dir
cd /app

# Script dir for sourcing shared scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/shared/basic.ash"
configure_basic_networking "$S3_SECRETS_BUCKET"

# Get vsock.json for enclave networking
aws s3 cp "s3://$S3_SECRETS_BUCKET/proxy/vsock.json" ./vsock.json --region "$S3_SECRETS_REGION"
source "$SCRIPT_DIR/shared/vsock.ash"
setup_vsock_networking "./vsock.json"

# Get config.env and source it
aws s3 cp "s3://$S3_SECRETS_BUCKET/proxy/config.env" ./config.env --region "$S3_SECRETS_REGION"

# Load env vars from config.env to global space
set -a
source ./config.env
set +a

if false; then #SSH#
  source "$SCRIPT_DIR/shared/ssh.ash"
  setup_ssh "$SSH_PUBLIC_KEY"
fi

# Add mongo host to /etc/hosts
# TODO: Solve this in configuration
echo "127.0.0.1 $(echo "$MONGO_HOST" | sed 's#-cluster.cluster-#-cluster.#')" | tee -a /etc/hosts

# NBD
source "$SCRIPT_DIR/shared/nbd.ash"
setup_nbd "proxy"

# Generate-once secret (shared/kms.ash), decrypted with attestation into /run/secrets.
# Master key of the mongodb `local` KMS provider (FLE, providers/db.ts): 96 random bytes
generate_once proxy fle_master_key "$AWS_KMS_FLE_ARN" "openssl rand -base64 96 | tr -d '\\n'"

echo "Fetching Caddyfile from S3"
CADDYFILE=Caddyfile
aws s3 cp "s3://$S3_SECRETS_BUCKET/proxy/$CADDYFILE" "./$CADDYFILE" --region "$S3_SECRETS_REGION"
if [ ! -f "./$CADDYFILE" ]; then
  echo "Couldn't download $CADDYFILE from S3, exiting"
  exit 1
fi

mkdir -p /mnt/encrypted/vector

source "$SCRIPT_DIR/shared/s6.ash"
source "$SCRIPT_DIR/shared/clock.ash"
setup_clock_sync

export HOME=/app

# node directly, not `npm start`: s6-supervise signals its direct child, and an
# npm wrapper would leak the node process on restart and keep holding the port.
s6_service express 'cd /app/proxy-service && export NODE_ENV=production && export FLE_MASTER_KEY="$(cat /run/secrets/fle_master_key)" && exec node index.ts'
s6_service caddy   'cd /app && exec caddy run --config /app/Caddyfile --adapter caddyfile'
s6_service node    'exec node_exporter --no-collector.kernel_hung'
s6_service vector  'exec vector --config /etc/vector/vector.yaml'

echo "Running services under s6"
exec s6-svscan /etc/s6
