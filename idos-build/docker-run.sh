#!/bin/bash
set -e

# Incoming
socat -d -d VSOCK-LISTEN:5006,fork TCP4-CONNECT:127.0.0.1:8080 &
# Outgoing
socat -d -d TCP4-LISTEN:27017,fork VSOCK-CONNECT:3:6006 &
socat -d -d TCP4-LISTEN:22,fork VSOCK-CONNECT:3:6007 &

# So that the FaceTec .so file can load some stuff on /tmp.
mount /tmp -o remount,exec

IMAGE_FILE="/home/FaceTec_Custom_Server/logs.img"
MOUNT_POINT="/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server/facetec-usage-logs"
if [ ! -e "$IMAGE_FILE" ]; then
    dd if=/dev/zero of="$IMAGE_FILE" bs=1M count=512
    mkfs.ext4 "$IMAGE_FILE"
fi
mkdir -p "$MOUNT_POINT"
echo "Making sure $MOUNT_POINT is un-mounted"
umount "$MOUNT_POINT" || true
echo "Mounting $MOUNT_POINT"
mount -o loop "$IMAGE_FILE" "$MOUNT_POINT"
echo "Done with mounting $MOUNT_POINT"

cd /home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server
npm start
echo '# ULS done, going for java #'

cd ..
java -jar FaceTec-Custom-Server.jar
