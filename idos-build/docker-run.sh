#!/bin/bash
set -e

# Incoming
socat VSOCK-LISTEN:5006,fork TCP4-CONNECT:127.0.0.1:8080 &

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

if cryptsetup isLuks /dev/nbd0; then
  echo "/dev/nbd0 is luks already, continuing..."
else
  echo "/dev/nbd0 is not luks, formatting..."
  # TODO(pkoch): sops -d fs.key.enc | cryptsetup luksFormat --batch-mode /dev/nbd0 --key-file -
  echo "buttbutt" | cryptsetup luksFormat --batch-mode /dev/nbd0 --key-file -
fi

# TODO(pkoch): sops -d fs.key.enc | cryptsetup luksOpen /dev/nbd0 encrypted_disk --key-file -
echo "buttbutt" | cryptsetup luksOpen /dev/nbd0 encrypted_disk --key-file -

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

echo "Running PM2-runtime"
export HOME=/home/FaceTec_Custom_Server
pm2-runtime ecosystem.config.js
