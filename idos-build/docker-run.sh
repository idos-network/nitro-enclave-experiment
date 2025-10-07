#!/bin/bash
set -ueo pipefail

# Incoming
socat VSOCK-LISTEN:5006,fork TCP4-CONNECT:127.0.0.1:80 &
socat VSOCK-LISTEN:5007,fork TCP4-CONNECT:127.0.0.1:443 &

# Outgoing (nbd)
socat TCP4-LISTEN:10809,fork,bind=127.0.0.1 VSOCK-CONNECT:3:10809 &

# Outgoing (mongo)
socat TCP4-LISTEN:27017,fork VSOCK-CONNECT:3:6006 &

# Outgoing (logs.facetec.com)
socat TCP4-LISTEN:22,fork VSOCK-CONNECT:3:6007 &

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

# So that the FaceTec .so file can load some stuff on /tmp.
mount /tmp -o remount,exec

echo "Checking nbd0..."
while ! nbd-client -c /dev/nbd0; do
  echo "Mounting nbd0..."
  nbd-client localhost 10809 /dev/nbd0 || true
  sleep 1
done
echo "Done with nbd0"

cd /home/FaceTec_Custom_Server/deploy

S3_SECRETS_BUCKET=$(cat ./s3_secrets_bucket.txt)

echo "Fetching mongo connection string from secrets"
aws s3 cp "s3://$S3_SECRETS_BUCKET/mongodb_uri.txt" ./mongodb_uri.txt --region eu-west-1
if [ ! -f ./mongodb_uri.txt ]; then
  echo "Couldn't download mongodb_uri.txt from S3, exiting"
  exit 1
fi

MONGO_URI="$(cat ./mongodb_uri.txt)"
sed -i "s#export const MONGO_URI = \"INSERT YOUR MONGO URL HERE\";#export const MONGO_URI = \"${MONGO_URI//&/\\&}\";#" ./facesign-service/env.js
sed -i "s#uri: INSERT YOUR MONGO URL HERE#uri: \"${MONGO_URI//&/\\&}\"#" ./config.yaml

echo "Fetching AWS luks password key from S3"
AWS_KMS_SECRETS_KEY_ID="$(cat ./secrets_key.arn)"
ENC_FILE=luks_password.enc
PLAIN_FILE=luks_password.txt

aws s3 cp "s3://$S3_SECRETS_BUCKET/$ENC_FILE" "$ENC_FILE" --region eu-west-1 2>aws_s3_cp_error.log || true

if [ ! -f "$ENC_FILE" ]; then
  echo "Couldn't download luks_password.enc from S3, generating a new one"
  aws kms encrypt --key-id "$AWS_KMS_SECRETS_KEY_ID" --plaintext "$(openssl rand -hex 64)" --output text --query CiphertextBlob --region eu-west-1 > "$ENC_FILE"
  aws s3 cp "$ENC_FILE" "s3://$S3_SECRETS_BUCKET/$ENC_FILE" --region eu-west-1
fi

echo "Decrypting AWS luks password key"
aws kms decrypt --ciphertext-blob "$(cat $ENC_FILE)" --output text --query Plaintext --region eu-west-1 > "$PLAIN_FILE"

echo "Fetching facetec private key from S3"
AWS_KMS_SECRETS_FACETEC_KEY_ID="$(cat ./secrets_facetec_key.arn)"
FACETEC_PRIVATE_ENC_FILE=facetec_private_key.pem.enc
FACETEC_PRIVATE_PLAIN_FILE=facetec_private_key.pem
FACETEC_PUBLIC_FILE=facetec_public_key.pem

aws s3 cp "s3://$S3_SECRETS_BUCKET/$FACETEC_PRIVATE_ENC_FILE" "$FACETEC_PRIVATE_ENC_FILE" --region eu-west-1 2>aws_s3_cp_error.log || true
if [ ! -f "$FACETEC_PRIVATE_ENC_FILE" ]; then
  echo "Couldn't download facetec_private_key.pem.enc from S3, creating a new one"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | openssl pkcs8 -topk8 -nocrypt &> "$FACETEC_PRIVATE_PLAIN_FILE"
  openssl pkey -in "$FACETEC_PRIVATE_PLAIN_FILE" -pubout -out "$FACETEC_PUBLIC_FILE"

  echo "Encrypting them with AWS KMS"
  aws kms encrypt --key-id "$AWS_KMS_SECRETS_FACETEC_KEY_ID" --plaintext fileb://$FACETEC_PRIVATE_PLAIN_FILE --output text --query CiphertextBlob --region eu-west-1 > "$FACETEC_PRIVATE_ENC_FILE"
  aws s3 cp "$FACETEC_PRIVATE_ENC_FILE" "s3://$S3_SECRETS_BUCKET/$FACETEC_PRIVATE_ENC_FILE" --region eu-west-1
  aws s3 cp "$FACETEC_PUBLIC_FILE" "s3://$S3_SECRETS_BUCKET/$FACETEC_PUBLIC_FILE" --region eu-west-1
  rm $FACETEC_PRIVATE_PLAIN_FILE
  rm $FACETEC_PUBLIC_FILE
fi

echo "Decrypting facetec private key"
aws kms decrypt --ciphertext-blob "$(cat $FACETEC_PRIVATE_ENC_FILE)" --output text --query Plaintext --region eu-west-1 | base64 -d > "$FACETEC_PRIVATE_PLAIN_FILE"

# Public facetec sdk key is stored unencrypted in the bucket
aws s3 cp "s3://$S3_SECRETS_BUCKET/$FACETEC_PUBLIC_FILE" "/home/FaceTec_Custom_Server/deploy/facesign-service/$FACETEC_PUBLIC_FILE" --region eu-west-1

# Replace facetec encryption private key in facetec service
sed -i "s|^faceMapEncryptionKey:.*|faceMapEncryptionKey: \"$(tr -d '\n' < "$FACETEC_PRIVATE_PLAIN_FILE")\"|" /home/FaceTec_Custom_Server/deploy/config.yaml

if cryptsetup isLuks /dev/nbd0; then
  echo "/dev/nbd0 is luks already, continuing..."
else
  echo "/dev/nbd0 is not luks, formatting..."
  cat $PLAIN_FILE | cryptsetup luksFormat --batch-mode /dev/nbd0 --key-file -
fi

cat $PLAIN_FILE | cryptsetup luksOpen /dev/nbd0 encrypted_disk --key-file -
rm -f $PLAIN_FILE

if ! blkid /dev/mapper/encrypted_disk > /dev/null 2>&1; then
  echo "Formatting /dev/mapper/encrypted_disk with ext4 filesystem..."
  mkfs.ext4 /dev/mapper/encrypted_disk
else
  echo "/dev/mapper/encrypted_disk already has a filesystem, continuing..."
fi

# Mount
mkdir /mnt/encrypted
mount /dev/mapper/encrypted_disk /mnt/encrypted

# Ensure there are 3d-db and logs directories
if [ ! -d /mnt/encrypted/facetec/search-3d-3d-database ]; then
  echo "Creating /mnt/encrypted/facetec directories..."
  mkdir -p \
      /mnt/encrypted/facetec/search-3d-3d-database \
      /mnt/encrypted/facetec/search-3d-3d-database-export \
      /mnt/encrypted/facetec/search-3d-3d-eye-covered \
      /mnt/encrypted/facetec/search-3d-2d-face-portrait \
      /mnt/encrypted/facetec/search-3d-2d-kiosk \
      /mnt/encrypted/facetec/search-2d-2d-id-scan

  # Running repopulate?!
  # node facesign-service/repopulate.js
fi

if [ ! -d /mnt/encrypted/logs ]; then
  echo "Creating /mnt/encrypted/logs directory..."
  mkdir -p /mnt/encrypted/logs
fi

echo "Ensure folder exists for caddy"
mkdir -p /mnt/encrypted/caddy
mkdir -p  /mnt/encrypted/caddy/acme/acme-staging-v02.api.letsencrypt.org-directory/users/deployers@idos.network/

# Set-up facesing service
echo "Fetching key 1 public multibase from S3"
KEY_1_MULTIBASE_PUBLIC_FILE=multibase_key_1_public.txt
aws s3 cp "s3://$S3_SECRETS_BUCKET/$KEY_1_MULTIBASE_PUBLIC_FILE" "./facesign-service/$KEY_1_MULTIBASE_PUBLIC_FILE" --region eu-west-1
if [ ! -f "./facesign-service/$KEY_1_MULTIBASE_PUBLIC_FILE" ]; then
  echo "Couldn't download $KEY_1_MULTIBASE_PUBLIC_FILE from S3, exiting"
  exit 1
fi

echo "Fetching hostname from S3"
HOSTNAME_FILE=host.txt
aws s3 cp "s3://$S3_SECRETS_BUCKET/$HOSTNAME_FILE" "./$HOSTNAME_FILE" --region eu-west-1
if [ ! -f "./$HOSTNAME_FILE" ]; then
  echo "Couldn't download $HOSTNAME_FILE from S3, exiting"
  exit 1
fi
HOST=$(cat ./$HOSTNAME_FILE)
sed -i "s#export const HOST = \"INSERT YOUR HOST HERE\";#export const HOST = \"${HOST//&/\\&}\";#" ./facesign-service/env.js

echo "Running PM2-runtime"
export HOME=/home/FaceTec_Custom_Server
pm2-runtime ecosystem.config.js
