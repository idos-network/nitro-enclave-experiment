#!/bin/bash
# shellcheck shell=dash

source "$(dirname "${BASH_SOURCE[0]}")/aws.ash"

setup_nbd() {
  local SERVICE_NAME=$1

  echo "💾 Starting and checking nbdkit for $SERVICE_NAME..."

  echo "–> opening socat for nbd on localhost:10809"
  socat -b65536 TCP4-LISTEN:10809,fork,backlog=1024,bind=127.0.0.1 VSOCK-CONNECT:3:10809 &

  echo "–> waiting for mounting nbd0 device"
  while ! nbd-client -c /dev/nbd0; do
    echo "Mounting nbd0..."
    nbd-client localhost 10809 /dev/nbd0 || true
    sleep 1
  done

  echo "-> Fetching AWS luks password key from S3"
  ENC_FILE=luks_entropy_password.enc
  PLAIN_FILE=luks_entropy_password.txt

  s3_get "$SERVICE_NAME/$ENC_FILE" "$ENC_FILE" 2>aws_s3_cp_error.log || true

  if [ ! -f "$ENC_FILE" ]; then
    echo "-> Couldn't download luks_entropy_password.enc from S3, generating a new one"
    # kms_encrypt takes base64 and the hex is valid base64, so the password stays the hex string
    kms_encrypt "$AWS_KMS_LUKS_ARN" "$(openssl rand -hex 64)" > "$ENC_FILE"
    # A failed download isn't proof the password is missing: never overwrite an existing one,
    # that would lock the disk for good. The bucket policy also denies a PutObject without it.
    s3_put_new "$SERVICE_NAME/$ENC_FILE" "$ENC_FILE"
  fi

  echo "-> Decrypting AWS luks password key"
  # Same bytes as before (base64 plaintext + newline), so existing LUKS volumes still open
  kms_decrypt "$(cat $ENC_FILE)" > "$PLAIN_FILE"

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
