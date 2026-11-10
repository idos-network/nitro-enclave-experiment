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
aws s3 cp "s3://$S3_SECRETS_BUCKET/enclave/vsock.json" ./vsock.json --region "$S3_SECRETS_REGION"
source "$SCRIPT_DIR/shared/vsock.ash"
setup_vsock_networking "./vsock.json"

# Get config.env and source it
aws s3 cp "s3://$S3_SECRETS_BUCKET/enclave/config.env" ./config.env --region "$S3_SECRETS_REGION"

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
source "$SCRIPT_DIR/shared/nbd.ash"
setup_nbd "enclave"

# generate_once <name> <command printing the base64 plaintext>: like the LUKS password, the
# secret is generated on first boot, KMS-encrypted into S3 as enclave/<name>.enc and decrypted
# with attestation (kms_decrypt) into /run/secrets/<name>, which like all but /mnt/encrypted
# is enclave RAM. The plaintext only ever exists inside an attested enclave.
generate_once() {
  local ENC_FILE="$1.enc"
  echo "-> Fetching $1 from S3"
  if ! aws s3 cp "s3://$S3_SECRETS_BUCKET/enclave/$ENC_FILE" "$ENC_FILE" --region "$S3_SECRETS_REGION"; then
    echo "-> Couldn't download $ENC_FILE from S3, generating a new one"
    aws kms encrypt --key-id "$AWS_KMS_FLE_ARN" --plaintext "$(eval "$2")" \
      --cli-binary-format base64 --output text --query CiphertextBlob --region "$AWS_REGION" > "$ENC_FILE"
    # A failed download isn't proof the key is missing: never overwrite an existing one
    aws s3api put-object --bucket "$S3_SECRETS_BUCKET" --key "enclave/$ENC_FILE" \
      --body "$ENC_FILE" --if-none-match '*' --region "$S3_SECRETS_REGION"
  fi
  kms_decrypt "$(cat "$ENC_FILE")" > "/run/secrets/$1"
}
mkdir -p -m 700 /run/secrets

# Master key of the mongodb `local` KMS provider (FLE, providers/db.ts): 96 random bytes
generate_once fle_master_key "openssl rand -base64 96 | tr -d '\\n'"
# Ed25519 session-signing key (providers/signing.ts), PKCS#8 PEM. KMS Sign can't require an
# attestation, so a KMS key would be usable by the host role; this one never leaves the enclave.
generate_once signing_key "openssl genpkey -algorithm ed25519 | base64 | tr -d '\\n'"
# Rotation (README): copy signing_key.enc to signing_key.previous.enc, delete signing_key.enc,
# restart. The previous key stays in the JWKS, so sessions signed before the rotation verify.
if aws s3 cp "s3://$S3_SECRETS_BUCKET/enclave/signing_key.previous.enc" signing_key.previous.enc --region "$S3_SECRETS_REGION"; then
  kms_decrypt "$(cat signing_key.previous.enc)" > /run/secrets/signing_key_previous
fi

echo "Fetching Caddyfile from S3"
CADDYFILE=Caddyfile
aws s3 cp "s3://$S3_SECRETS_BUCKET/enclave/$CADDYFILE" "./$CADDYFILE" --region "$S3_SECRETS_REGION"
if [ ! -f "./$CADDYFILE" ]; then
  echo "Couldn't download $CADDYFILE from S3, exiting"
  exit 1
fi

mkdir -p /mnt/encrypted/vector

source "$SCRIPT_DIR/shared/s6.ash"

export HOME=/app

# node directly, not `npm start`: s6-supervise signals its direct child, and an
# npm wrapper would leak the node process on restart and keep holding the port.
s6_service express 'cd /app/enclave-service && export NODE_ENV=production && export FLE_MASTER_KEY="$(cat /run/secrets/fle_master_key)" SIGNING_KEY="$(cat /run/secrets/signing_key)" SIGNING_KEY_PREVIOUS="$(cat /run/secrets/signing_key_previous 2>/dev/null || true)" && exec node index.ts'
s6_service caddy   'cd /app && exec caddy run --config /app/Caddyfile --adapter caddyfile'
s6_service node    'exec node_exporter --no-collector.kernel_hung'
s6_service vector  'exec vector --config /etc/vector/vector.yaml'

echo "Running services under s6"
exec s6-svscan /etc/s6
