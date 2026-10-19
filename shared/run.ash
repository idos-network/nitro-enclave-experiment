#!/bin/ash
# shellcheck shell=dash
set -ueo pipefail

# Enclave boot for the plain node services (enclave, entropy, proxy):
#   CMD ["/bin/bash", "/app/shared/run.ash", "<service>"]
# <service> is the S3 prefix in $S3_SECRETS_BUCKET and the NBD volume name.
# facesign has its own scripts/run.ash (FaceTec server, extra keys).
SERVICE=$1

# Go to app dir
cd /app

source "/app/shared/basic.ash"
configure_basic_networking "$S3_SECRETS_BUCKET"

# Get vsock.json for enclave networking
aws s3 cp "s3://$S3_SECRETS_BUCKET/$SERVICE/vsock.json" ./vsock.json --region "$S3_SECRETS_REGION"
source "/app/shared/vsock.ash"
setup_vsock_networking "./vsock.json"

# Get config.env and source it
aws s3 cp "s3://$S3_SECRETS_BUCKET/$SERVICE/config.env" ./config.env --region "$S3_SECRETS_REGION"

# Load env vars from config.env to global space
set -a
source ./config.env
set +a

if false; then #SSH#
  source "$SCRIPT_DIR/shared/ssh.ash"
  setup_ssh "${SSH_PUBLIC_KEY:-}"
fi

# Add mongo host to /etc/hosts
# TODO: Solve this in configuration
echo "127.0.0.1 $(echo "$MONGO_HOST" | sed 's#-cluster.cluster-#-cluster.#')" | tee -a /etc/hosts

# NBD
source "/app/shared/nbd.ash"
setup_nbd "$SERVICE"

echo "Fetching Caddyfile from S3"
CADDYFILE=Caddyfile
aws s3 cp "s3://$S3_SECRETS_BUCKET/$SERVICE/$CADDYFILE" "./$CADDYFILE" --region "$S3_SECRETS_REGION"
if [ ! -f "./$CADDYFILE" ]; then
  echo "Couldn't download $CADDYFILE from S3, exiting"
  exit 1
fi

# Service specific setup (e.g. extra secrets) before the s6 services start
if [ -f /app/scripts/setup.ash ]; then
  source /app/scripts/setup.ash
fi

mkdir -p /mnt/encrypted/vector

source "/app/shared/s6.ash"

export HOME=/app
# node directly, not `npm start`: s6-supervise signals its direct child, and an
# npm wrapper would leak the node process on restart and keep holding the port.
s6_service express 'cd /app && export NODE_ENV=production && exec node index.ts'
s6_service caddy   'cd /app && exec caddy run --config /app/Caddyfile --adapter caddyfile'
s6_service node    'exec node_exporter --no-collector.kernel_hung'
s6_service vector  'exec vector --config /etc/vector/vector.yaml'

echo "Running services under s6"
exec s6-svscan /etc/s6
