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

# Download the keys for gocryptfs
echo "Mounting gocryptfs keys from s3"
S3_BUCKET="nitro-enclave-hello-config"
KEY_MOUNT_POINT="/home/FaceTec_Custom_Server/deploy/keys"
mkdir -p "$KEY_MOUNT_POINT"
echo "Making sure $KEY_MOUNT_POINT is un-mounted"
umount "$KEY_MOUNT_POINT" || true
echo "Mounting $KEY_MOUNT_POINT"
s3fs "$S3_BUCKET" "$KEY_MOUNT_POINT" -o iam_role=auto
echo "Done with mounting $KEY_MOUNT_POINT"

# Mount s3fs
S3_BUCKET="nitro-enclave-hello-usage-logs"
MOUNT_POINT="/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server/facetec-usage-logs-s3"
mkdir -p "$MOUNT_POINT"
echo "Making sure $MOUNT_POINT is un-mounted"
umount "$MOUNT_POINT" || true
echo "Mounting $MOUNT_POINT"
s3fs "$S3_BUCKET" "$MOUNT_POINT" -o iam_role=auto
echo "Done with mounting $MOUNT_POINT"

S3_3D_DB_BUCKET="nitro-enclave-hello-3d-db"
MOUNT_POINT_3D_DB="/home/FaceTec_Custom_Server/deploy/three_d_db-s3"
mkdir -p "$MOUNT_POINT_3D_DB"
echo "Making sure $MOUNT_POINT_3D_DB is un-mounted"
umount "$MOUNT_POINT_3D_DB" || true
echo "Mounting $MOUNT_POINT_3D_DB"
s3fs "$S3_3D_DB_BUCKET" "$MOUNT_POINT_3D_DB" -o iam_role=auto
echo "Done with mounting $MOUNT_POINT_3D_DB"

# Mount gocryptfs
S3_FOLDER="/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server/facetec-usage-logs-s3"
MOUNT_POINT="/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server/facetec-usage-logs"
KEY="$KEY_MOUNT_POINT/gocryptfs_usage_logs.key.enc"
mkdir -p "$MOUNT_POINT"
echo "Making sure $MOUNT_POINT is un-mounted"
umount "$MOUNT_POINT" || true
echo "Mounting gocryptfs filesystem $MOUNT_POINT"
sops -d "$KEY" | gocryptfs "$S3_FOLDER" "$MOUNT_POINT" -nosyslog

S3_FOLDER="/home/FaceTec_Custom_Server/deploy/three_d_db-s3"
MOUNT_POINT="/home/FaceTec_Custom_Server/deploy/three_d_db"
KEY="$KEY_MOUNT_POINT/gocryptfs_3d_db.key.enc"
mkdir -p "$MOUNT_POINT"
echo "Making sure $MOUNT_POINT is un-mounted"
umount "$MOUNT_POINT" || true
echo "Mounting gocryptfs filesystem $MOUNT_POINT"
sops -d "$KEY" | gocryptfs "$S3_FOLDER" "$MOUNT_POINT" -nosyslog

echo "Unmounting $KEY_MOUNT_POINT"
umount $KEY_MOUNT_POINT || true

cd /home/FaceTec_Custom_Server/deploy

echo "Running PM2-runtime"
export HOME=/home/FaceTec_Custom_Server
pm2-runtime ecosystem.config.js