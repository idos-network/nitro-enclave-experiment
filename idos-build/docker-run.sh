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

# So that the FaceTec .so file can load some stuff on /tmp.
mount /tmp -o remount,exec

# Mount nbd0 drive
sleep 2
nbd-client localhost 10809 /dev/nbd0 &

# Wait for nbd0 to be ready (for some reason the luksOpen immediatelly complains)
while [ "$(cat /sys/block/nbd0/size)" -eq 0 ]; do
  echo "Waiting for /dev/nbd0 to be ready..."
  sleep 0.5
done

cd /home/FaceTec_Custom_Server/deploy

# Ensure the key
AWS_KMS_KEY_ID="$(cat ./secrets_key.arn)"
ENC_FILE=luks_password.enc
PLAIN_FILE=luks_password.txt

aws s3 cp "s3://nitro-enclave-hello-secrets/$ENC_FILE" "$ENC_FILE" --region eu-west-1 2>aws_s3_cp_error.log || true
if ! grep -q ': Key "'"$ENC_FILE"'" does not exist$' aws_s3_cp_error.log; then
  cat aws_s3_cp_error.log
  exit 1
fi
rm -f aws_s3_cp_error.log

if [ ! -f "$ENC_FILE" ]; then
  echo "Couldn't download luks_password.enc from S3, generating a new one"
  aws kms encrypt --key-id "$AWS_KMS_KEY_ID" --plaintext "$(openssl rand -hex 64)" --output text --query CiphertextBlob --region eu-west-1 > "$ENC_FILE"
  aws s3 cp "$ENC_FILE" "s3://nitro-enclave-hello-secrets/$ENC_FILE" --region eu-west-1
fi

# Decrypt the key
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

# Ensure there are 3d-db and logs directories
if [ ! -d /mnt/encrypted/3d-db ]; then
  echo "Creating /mnt/encrypted/3d-db directory..."
  mkdir -p /mnt/encrypted/3d-db

  # Running repopulate?!
  # node facesign-service/repopulate.js
fi

if [ ! -d /mnt/encrypted/logs ]; then
  echo "Creating /mnt/encrypted/logs directory..."
  mkdir -p /mnt/encrypted/logs
fi

echo "Setting up Caddyfile..."
mkdir -p /mnt/encrypted/caddy
cat <<'EOF' | tee /home/FaceTec_Custom_Server/Caddyfile
{
    storage file_system /mnt/encrypted/caddy
}

https://enclave.idos.network {
    encode gzip
    reverse_proxy 127.0.0.1:7000
}
EOF

echo "Running PM2-runtime"
export HOME=/home/FaceTec_Custom_Server
pm2-runtime ecosystem.config.js
