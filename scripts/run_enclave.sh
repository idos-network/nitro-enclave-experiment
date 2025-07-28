#!/bin/bash
# run_enclave.sh - Launch the enclave and set up port forwarding
set -xe

# Run the enclave using the generated EIF (allocating memory and vCPUs as specified)
nitro-cli run-enclave --eif-path enclave/hello.eif --memory 1024 --cpu-count 2 --enclave-cid 16 --debug-mode

# Give the enclave a moment to start up
sleep 5

# Use socat to forward host port 80 to enclave vsock port 5005 for HTTP traffic
socat TCP-LISTEN:80,reuseaddr,fork VSOCK-CONNECT:16:5005 &

echo "Enclave web server is running. You can access it via the EC2 instance's public IP on port 80."
