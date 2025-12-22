#!/bin/bash
set -ueo pipefail

cd /home/deploy/

# Script dir for sourcing shared scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configure minimal networking to reach S3
source "$SCRIPT_DIR/shared/basic.ash"
configure_basic_networking "$S3_SECRETS_BUCKET"

# Get vsock.json for enclave networking
aws s3 cp "s3://$S3_SECRETS_BUCKET/facesign/vsock.json" ./vsock.json --region eu-west-1
source "$SCRIPT_DIR/shared/vsock.ash"
setup_vsock_networking "./vsock.json"

# Get config.env and source it
aws s3 cp "s3://$S3_SECRETS_BUCKET/facesign/config.env" ./config.env --region eu-west-1

# Load env vars from config.env to global space
set -a
source ./config.env
set +a

if true; then #SSH#
  source "$SCRIPT_DIR/shared/ssh.ash"
  setup_ssh "$SSH_PUBLIC_KEY"
fi

# Add mongo host to /etc/hosts
# TODO: Solve this in configuration
echo "127.0.0.1 $(echo "$MONGO_HOST" | sed 's#-cluster.cluster-#-cluster.#')" | tee -a /etc/hosts

# NBD
source "$SCRIPT_DIR/shared/nbd.ash"
setup_nbd "facesign"

echo "Fetching Caddyfile from S3"
CADDYFILE=Caddyfile
aws s3 cp "s3://$S3_SECRETS_BUCKET/facesign/$CADDYFILE" "./$CADDYFILE" --region eu-west-1
if [ ! -f "./$CADDYFILE" ]; then
  echo "Couldn't download $CADDYFILE from S3, exiting"
  exit 1
fi

echo "Ensure folder exists for caddy"
mkdir -p /mnt/encrypted/caddy
mkdir -p  /mnt/encrypted/caddy/acme/acme-staging-v02.api.letsencrypt.org-directory/users/deployers@fractal.id/

# So that the FaceTec .so file can load some stuff on /tmp.
mount /tmp -o remount,exec

# Setup mongo uri in env.ts and facetec config.yaml
sed -i "s#uri: INSERT YOUR MONGO URL HERE#uri: \"${MONGO_URI//&/\\&}\"#" $HOME_FACETEC_CUSTOM_SERVER/deploy/config.yaml
sed -i "s#export const MONGO_URI = \"INSERT YOUR MONGO URL HERE\";#export const MONGO_URI = \"${MONGO_URI//&/\\&}\";#" $HOME_FACESIGN_SERVICE/env.ts
sed -i "s#export const HOST = \"INSERT YOUR HOST HERE\";#export const HOST = \"${HOST//&/\\&}\";#" $HOME_FACESIGN_SERVICE/env.ts

echo "Fetching FaceTec SDK server core jar from S3"
aws s3 sync "s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION/libs/" /home/FaceTec_Server_Core/libs  --region eu-west-1
aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/URCTemplates /home/URCTemplates
aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/OCRTemplates /home/OCRTemplates

echo "Fetching facetec private key from S3"
FACETEC_PRIVATE_ENC_FILE=facetec_private_key.pem.enc
FACETEC_PRIVATE_PLAIN_FILE=facetec_private_key.pem
FACETEC_PUBLIC_FILE=facetec_public_key.pem

aws s3 cp "s3://$S3_SECRETS_BUCKET/facesign/$FACETEC_PRIVATE_ENC_FILE" "$FACETEC_PRIVATE_ENC_FILE" --region eu-west-1 2>aws_s3_cp_error.log || true
if [ ! -f "$FACETEC_PRIVATE_ENC_FILE" ]; then
  echo "Couldn't download facetec_private_key.pem.enc from S3, creating a new one"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | openssl pkcs8 -topk8 -nocrypt &> "$FACETEC_PRIVATE_PLAIN_FILE"
  openssl pkey -in "$FACETEC_PRIVATE_PLAIN_FILE" -pubout -out "$FACETEC_PUBLIC_FILE"

  echo "Encrypting them with AWS KMS"
  aws kms encrypt --key-id "$AWS_KMS_SECRETS_FACETEC_KEY_ID" --plaintext fileb://$FACETEC_PRIVATE_PLAIN_FILE --output text --query CiphertextBlob --region eu-west-1 > "$FACETEC_PRIVATE_ENC_FILE"
  aws s3 cp "$FACETEC_PRIVATE_ENC_FILE" "s3://$S3_SECRETS_BUCKET/facesign/$FACETEC_PRIVATE_ENC_FILE" --region eu-west-1
  aws s3 cp "$FACETEC_PUBLIC_FILE" "s3://$S3_SECRETS_BUCKET/facesign/$FACETEC_PUBLIC_FILE" --region eu-west-1
  rm $FACETEC_PRIVATE_PLAIN_FILE
  rm $FACETEC_PUBLIC_FILE
fi

echo "Decrypting facetec private key"
aws kms decrypt --ciphertext-blob "$(cat $FACETEC_PRIVATE_ENC_FILE)" --output text --query Plaintext --region eu-west-1 | base64 -d > "$FACETEC_PRIVATE_PLAIN_FILE"

# Public facetec sdk key is stored unencrypted in the bucket
aws s3 cp "s3://$S3_SECRETS_BUCKET/facesign/$FACETEC_PUBLIC_FILE" "$HOME_FACESIGN_SERVICE/$FACETEC_PUBLIC_FILE" --region eu-west-1

# Replace facetec encryption private key in facetec service
sed -i "s|^faceMapEncryptionKey:.*|faceMapEncryptionKey: \"$(tr -d '\n' < "$FACETEC_PRIVATE_PLAIN_FILE")\"|" $HOME_FACETEC_CUSTOM_SERVER/deploy/config.yaml

# Ensure there are 3d-db and logs directories
echo "Creating /mnt/encrypted/facetec directories..."
mkdir -p \
    /mnt/encrypted/facetec/search-3d-3d-database \
    /mnt/encrypted/facetec/search-3d-3d-database-export \
    /mnt/encrypted/facetec/search-3d-3d-accessibility \
    /mnt/encrypted/facetec/search-3d-2d-face-portrait \
    /mnt/encrypted/facetec/search-3d-2d-kiosk \
    /mnt/encrypted/facetec/search-2d-2d-id-scan \
    /mnt/encrypted/facetec/search-2d-2d-profile-pic \
    /mnt/encrypted/facetec/search-2d-2d-face-portrait \
    /mnt/encrypted/logs

# Set-up facesign service
echo "Fetching key 1 public multibase from S3"
KEY_1_MULTIBASE_PUBLIC_FILE=multibase_key_1_public.txt
aws s3 cp "s3://$S3_SECRETS_BUCKET/$KEY_1_MULTIBASE_PUBLIC_FILE" "$HOME_FACESIGN_SERVICE/$KEY_1_MULTIBASE_PUBLIC_FILE" --region eu-west-1
if [ ! -f "$HOME_FACESIGN_SERVICE/$KEY_1_MULTIBASE_PUBLIC_FILE" ]; then
  echo "Couldn't download $KEY_1_MULTIBASE_PUBLIC_FILE from S3, exiting"
  exit 1
fi

echo "Fetching JWT token secret from S3"
JWT_TOKEN_SECRET_FILE=jwt_token_private.pem.enc
JWT_TOKEN_PUBLIC_FILE=jwt_token_public.pem

# Those are shared between entropy and facesign services (so not in /facesign s3)
aws s3 cp "s3://$S3_SECRETS_BUCKET/$JWT_TOKEN_SECRET_FILE" "./$JWT_TOKEN_SECRET_FILE" --region eu-west-1 2>aws_s3_cp_error.log || true
if [ ! -f "./$JWT_TOKEN_SECRET_FILE" ]; then
  echo "JWT secret not found in S3, generating a new one ..."
  openssl ecparam -name secp521r1 -genkey -noout -out jwt_token_private.pem
  openssl ec -in jwt_token_private.pem -pubout -out jwt_token_public.pem

  echo "Encrypting JWT token secret with AWS KMS..."
  aws kms encrypt --key-id "$AWS_KMS_JWT_KEY_ID" --plaintext fileb://jwt_token_private.pem --output text --query CiphertextBlob --region eu-west-1  > "$JWT_TOKEN_SECRET_FILE"

  echo "Uploading both parts of JWT key in S3..."
  aws s3 cp "./$JWT_TOKEN_SECRET_FILE" "s3://$S3_SECRETS_BUCKET/$JWT_TOKEN_SECRET_FILE" --region eu-west-1
  aws s3 cp "./$JWT_TOKEN_PUBLIC_FILE" "s3://$S3_SECRETS_BUCKET/$JWT_TOKEN_PUBLIC_FILE" --region eu-west-1
fi

echo "Decrypting JWT token private key"
aws kms decrypt --ciphertext-blob "$(cat $JWT_TOKEN_SECRET_FILE)" --output text --query Plaintext --region eu-west-1 | base64 -d > $HOME_FACESIGN_SERVICE/jwt_token_private.pem

echo "Running PM2-runtime"
export HOME=/home/deploy
pm2-runtime ecosystem.config.js
