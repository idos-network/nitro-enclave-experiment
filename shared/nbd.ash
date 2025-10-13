#!/bin/bash
# shellcheck shell=dash

setup_nbd() {
  echo "💾 Starting and checking bdkit..."

  echo "–> opening socat for nbd on localhost:10809"
  socat TCP4-LISTEN:10809,fork,bind=127.0.0.1 VSOCK-CONNECT:3:10809 &

  echo "–> waiting for mounting nbd0 device"
  while ! nbd-client -c /dev/nbd0; do
    echo "Mounting nbd0..."
    nbd-client localhost 10809 /dev/nbd0 || true
    sleep 1
  done

  echo "-> Fetching AWS luks password key from S3"
  ENC_FILE=luks_entropy_password.enc
  PLAIN_FILE=luks_entropy_password.txt

  aws s3 cp "s3://$S3_SECRETS_BUCKET/entropy/$ENC_FILE" "$ENC_FILE" --region eu-west-1 2>aws_s3_cp_error.log || true

  if [ ! -f "$ENC_FILE" ]; then
    echo "-> Couldn't download luks_entropy_password.enc from S3, generating a new one"
    aws kms encrypt --key-id "$KMS_FLE_ARN" --plaintext "$(openssl rand -hex 64)" --output text --query CiphertextBlob --region eu-west-1 > "$ENC_FILE"
    aws s3 cp "$ENC_FILE" "s3://$S3_SECRETS_BUCKET/entropy/$ENC_FILE" --region eu-west-1
  fi

  echo "-> Decrypting AWS luks password key"
  aws kms decrypt --ciphertext-blob "$(cat $ENC_FILE)" --output text --query Plaintext --region eu-west-1 > "$PLAIN_FILE"

  if cryptsetup isLuks /dev/nbd0; then
    echo "-> /dev/nbd0 is luks already, continuing..."
  else
    echo "-> /dev/nbd0 is not luks, formatting..."
    cat $PLAIN_FILE | cryptsetup luksFormat --batch-mode /dev/nbd0 --key-file -
  fi

  cat $PLAIN_FILE | cryptsetup luksOpen /dev/nbd0 encrypted_disk --key-file -
  rm -f $PLAIN_FILE

  if ! blkid /dev/mapper/encrypted_disk > /dev/null 2>&1; then
    echo "-> Formatting /dev/mapper/encrypted_disk with ext4 filesystem..."
    mkfs.ext4 /dev/mapper/encrypted_disk
  else
    echo "-> /dev/mapper/encrypted_disk already has a filesystem, continuing..."
  fi

  # Mount
  mkdir /mnt/encrypted
  mount /dev/mapper/encrypted_disk /mnt/encrypted
}
