#!/bin/bash
set -e

# Incoming
socat -d -d VSOCK-LISTEN:5006,fork TCP4-CONNECT:127.0.0.1:8080 &

# Outgoing
socat -d -d TCP4-LISTEN:27017,fork VSOCK-CONNECT:3:6006 &
socat -d -d TCP4-LISTEN:22,fork VSOCK-CONNECT:3:6007 &
socat -d -d TCP4-LISTEN:80,fork,bind=127.0.0.2 VSOCK-CONNECT:3:6008 &
socat -d -d TCP4-LISTEN:443,fork,bind=127.0.0.3 VSOCK-CONNECT:3:6009 &
socat -d -d TCP4-LISTEN:443,fork,bind=127.0.0.4 VSOCK-CONNECT:3:6010 &
socat -d -d TCP4-LISTEN:443,fork,bind=127.0.0.5 VSOCK-CONNECT:3:6011 &
socat -d -d TCP4-LISTEN:443,fork,bind=127.0.0.6 VSOCK-CONNECT:3:6012 &
socat -d -d TCP4-LISTEN:443,fork,bind=127.0.0.7 VSOCK-CONNECT:3:6013 &
socat -d -d TCP4-LISTEN:443,fork,bind=127.0.0.8 VSOCK-CONNECT:3:6014 &
socat -d -d TCP4-LISTEN:443,fork,bind=127.0.0.9 VSOCK-CONNECT:3:6015 &
socat -d -d TCP4-LISTEN:443,fork,bind=127.0.0.10 VSOCK-CONNECT:3:6016 &

# So that the FaceTec .so file can load some stuff on /tmp.
mount /tmp -o remount,exec


# Helpers
mount_s3() {
  local bucket="$1"
  local mount_point="$2"
  mkdir -p "$mount_point"
  echo "Ensuring $mount_point is unmounted"
  umount "$mount_point" || true
  echo "Mounting S3 bucket $bucket to $mount_point"
  s3fs "$bucket" "$mount_point" -o iam_role=auto
}

mount_gocryptfs() {
  local s3_folder="$1"
  local mount_point="$2"
  local key_file="$3"

  mkdir -p "$mount_point"
  echo "Ensuring $mount_point is unmounted"
  umount "$mount_point" || true

  if [ ! -e "$s3_folder/gocryptfs.conf" ]; then
    echo "Initializing gocryptfs in $s3_folder"
    sops -d "$key_file" | gocryptfs -init "$s3_folder" -nosyslog
  else
    echo "$s3_folder already initialized"
  fi

  echo "Mounting gocryptfs $s3_folder -> $mount_point"
  sops -d "$key_file" | gocryptfs "$s3_folder" "$mount_point" -nosyslog
}

# Mount the keys first
KEY_MOUNT_POINT="/home/FaceTec_Custom_Server/deploy/keys"
mount_s3 "nitro-enclave-hello-config" "$KEY_MOUNT_POINT"

mount_s3 "nitro-enclave-hello-usage-logs" \
  "/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server/facetec-usage-logs-s3"

mount_s3 "nitro-enclave-hello-3d-db" \
  "/home/FaceTec_Custom_Server/deploy/three_d_db-s3"

# Mount gocryptfs filesystems
mount_gocryptfs \
  "/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server/facetec-usage-logs-s3" \
  "/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server/facetec-usage-logs" \
  "$KEY_MOUNT_POINT/gocryptfs_usage_logs.key.enc"

mount_gocryptfs \
  "/home/FaceTec_Custom_Server/deploy/three_d_db-s3" \
  "/home/FaceTec_Custom_Server/deploy/three_d_db" \
  "$KEY_MOUNT_POINT/gocryptfs_3d_db.key.enc"

echo "Unmounting keys"
umount "$KEY_MOUNT_POINT" || true

echo "Running PM2-runtime"
cd /home/FaceTec_Custom_Server/deploy
export HOME=/home/FaceTec_Custom_Server
pm2-runtime ecosystem.config.js
