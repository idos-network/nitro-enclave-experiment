#!/usr/bin/env bash
set -euo pipefail

EC2_IP=$1
EC2_USER="ec2-user"

echo "Syncing: $EC2_IP"

rsync -avz --progress ./facesign-service "$EC2_USER@$EC2_IP:~/server/" --exclude "node_modules"
rsync -avz --progress ./shared "$EC2_USER@$EC2_IP:~/server/facesign-service/scripts/" 
rsync -avz --progress ./aws-nitro-kernel/blobs/ "$EC2_USER@$EC2_IP:nitro-kernel-blobs/"
ssh "$EC2_USER@$EC2_IP" "sudo rm -rf /usr/share/nitro_enclaves/blobs && sudo mv ./nitro-kernel-blobs /usr/share/nitro_enclaves/blobs"
