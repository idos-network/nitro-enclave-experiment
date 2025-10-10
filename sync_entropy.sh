#!/usr/bin/env bash
set -euo pipefail

EC2_IP=$1
EC2_USER="ec2-user"

echo "Syncing: $EC2_IP"

rsync -avz --progress ./entropy-service "$EC2_USER@$EC2_IP:~/" --exclude "node_modules"
