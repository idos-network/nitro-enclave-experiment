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

cd /home/deploy/

# S3 secrets
S3_SECRETS_BUCKET=$(cat ./s3_secrets_bucket.txt)

# NBD device
echo "Checking nbd0..."
while ! nbd-client -c /dev/nbd0; do
  echo "Mounting nbd0..."
  nbd-client localhost 10809 /dev/nbd0 || true
  sleep 1
done
echo "Done with nbd0"

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

echo "Fetching mongo connection string from secrets"
aws s3 cp "s3://$S3_SECRETS_BUCKET/mongodb_uri.txt" ./mongodb_uri.txt --region eu-west-1
if [ ! -f ./mongodb_uri.txt ]; then
  echo "Couldn't download mongodb_uri.txt from S3, exiting"
  exit 1
fi

MONGO_URI="$(cat ./mongodb_uri.txt)"
sed -i "s#export const MONGO_URI = \"INSERT YOUR MONGO URL HERE\";#export const MONGO_URI = \"${MONGO_URI//&/\\&}\";#" $HOME_FACESIGN_SERVICE/env.ts
sed -i "s#uri: INSERT YOUR MONGO URL HERE#uri: \"${MONGO_URI//&/\\&}\"#" $HOME_FACETEC_CUSTOM_SERVER/deploy/config.yaml

echo "Fetching FaceTec SDK server core jar from S3"
aws s3 sync "s3://$S3_SECRETS_BUCKET/FaceTec_Server_Core/" /home/FaceTec_Server_Core/  --region eu-west-1

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
aws s3 cp "s3://$S3_SECRETS_BUCKET/$FACETEC_PUBLIC_FILE" "$HOME_FACESIGN_SERVICE/$FACETEC_PUBLIC_FILE" --region eu-west-1

# Replace facetec encryption private key in facetec service
sed -i "s|^faceMapEncryptionKey:.*|faceMapEncryptionKey: \"$(tr -d '\n' < "$FACETEC_PRIVATE_PLAIN_FILE")\"|" $HOME_FACETEC_CUSTOM_SERVER/deploy/config.yaml

# Ensure there are 3d-db and logs directories
if [ ! -d /mnt/encrypted/facetec/search-3d-3d-database ]; then
  echo "Creating /mnt/encrypted/facetec directories..."
  mkdir -p \
      /mnt/encrypted/facetec/search-3d-3d-database \
      /mnt/encrypted/facetec/search-3d-3d-database-export \
      /mnt/encrypted/facetec/search-3d-3d-accessibility \
      /mnt/encrypted/facetec/search-3d-2d-face-portrait \
      /mnt/encrypted/facetec/search-3d-2d-kiosk \
      /mnt/encrypted/facetec/search-2d-2d-id-scan \
      /mnt/encrypted/facetec/search-2d-2d-profile-pic \
      /mnt/encrypted/facetec/search-2d-2d-face-portrait

  # Running repopulate?!
  # node facesign-service/repopulate.js
fi

if [ ! -d /mnt/encrypted/logs ]; then
  echo "Creating /mnt/encrypted/logs directory..."
  mkdir -p /mnt/encrypted/logs
fi

# Set-up facesing service
echo "Fetching key 1 public multibase from S3"
KEY_1_MULTIBASE_PUBLIC_FILE=multibase_key_1_public.txt
aws s3 cp "s3://$S3_SECRETS_BUCKET/$KEY_1_MULTIBASE_PUBLIC_FILE" "$HOME_FACESIGN_SERVICE/$KEY_1_MULTIBASE_PUBLIC_FILE" --region eu-west-1
if [ ! -f "$HOME_FACESIGN_SERVICE/$KEY_1_MULTIBASE_PUBLIC_FILE" ]; then
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
sed -i "s#export const HOST = \"INSERT YOUR HOST HERE\";#export const HOST = \"${HOST//&/\\&}\";#" $HOME_FACESIGN_SERVICE/env.ts

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

echo "Fetching JWT token secret from S3"
AWS_KMS_JWT_KEY_ID="$(cat ./jwt_key.arn)"
JWT_TOKEN_SECRET_FILE=jwt_token_private.pem.enc
JWT_TOKEN_PUBLIC_FILE=jwt_token_public.pem

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
