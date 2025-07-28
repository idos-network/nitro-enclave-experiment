#!/bin/sh
# Entry point script for enclave: start the Node.js server and socat vsock proxy

# Launch the Node.js application in background
node /app/app.js &

# Use socat to listen on vsock port 5005 and forward to the Node.js server on 127.0.0.1:3000
exec socat VSOCK-LISTEN:5005,fork TCP:127.0.0.1:3000
