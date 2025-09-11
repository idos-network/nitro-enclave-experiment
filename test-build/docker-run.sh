#!/bin/bash
set -e

# Incoming
socat VSOCK-LISTEN:5006,fork TCP4-CONNECT:127.0.0.1:8080 &


# Outgoing (nbd)
socat TCP4-LISTEN:10809,fork,bind=127.0.0.1 VSOCK-CONNECT:3:10809 &
socat TCP4-LISTEN:27017,fork VSOCK-CONNECT:3:6006 &
socat TCP4-LISTEN:22,fork VSOCK-CONNECT:3:6007 &
socat TCP4-LISTEN:80,fork,bind=127.0.0.2 VSOCK-CONNECT:3:6008 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.3 VSOCK-CONNECT:3:6009 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.4 VSOCK-CONNECT:3:6010 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.5 VSOCK-CONNECT:3:6011 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.6 VSOCK-CONNECT:3:6012 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.7 VSOCK-CONNECT:3:6013 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.8 VSOCK-CONNECT:3:6014 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.9 VSOCK-CONNECT:3:6015 &
socat TCP4-LISTEN:443,fork,bind=127.0.0.10 VSOCK-CONNECT:3:6016 &

nbd-client localhost 10809 /dev/nbd0 &

# cryptsetup luksFormat /dev/nbd0
# cryptsetup luksOpen /dev/nbd0 encrypted_disk < password
# mkfs.xfs /dev/mapper/encrypted_disk
# mkfs.ext4 /dev/mapper/encrypted_disk
# mkdir /mnt/encrypted
# mount /dev/mapper/encrypted_disk /mnt/encrypted

cd /home/test
npm start
