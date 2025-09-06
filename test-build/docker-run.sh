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

# Mount s3fs
# s3fs nitro-enclave-usage-logs /home/test/logs -o iam_role=auto -o dbglevel=info -f -o curldbg > /var/log/s3fs.log 2>&1

cd /home/test

npm start
