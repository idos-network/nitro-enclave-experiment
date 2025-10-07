#!/usr/bin/env bash
set -euo pipefail

EC2_IP=$(cd terraform && terraform output -raw ec2_public_ip)
EC2_USER="ec2-user"

echo "Syncing: $EC2_IP"

rsync -avz --progress ./facetec-sdk/ "$EC2_USER@$EC2_IP:custom-server/"
rsync -avz --progress ./idos-build/ "$EC2_USER@$EC2_IP:custom-server/"
rsync -avz --progress ./facesign-service "$EC2_USER@$EC2_IP:custom-server/"
rsync -avz --progress ./agent "$EC2_USER@$EC2_IP:~"
rsync -avz --progress ./aws-nitro-kernel/blobs/ "$EC2_USER@$EC2_IP:nitro-kernel-blobs/"
ssh "$EC2_USER@$EC2_IP" "sudo rm -rf /usr/share/nitro_enclaves/blobs && sudo mv ./nitro-kernel-blobs /usr/share/nitro_enclaves/blobs"
