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

cd /home/test
npm start
