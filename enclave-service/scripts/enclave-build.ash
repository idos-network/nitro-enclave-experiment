#!/bin/ash
# shellcheck shell=dash
set -u
set -o pipefail

TARGET_DOCKER_IMAGE=idos-enclave

# Cleanup. This is ok to fail and proceed.
sudo nitro-cli terminate-enclave --all
sudo rm -rf /tmp/??????????
sudo rm -f "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif"

set -e

S3_SECRETS_BUCKET=$(aws s3api list-buckets --query "Buckets[?contains(Name, 'facesign') && contains(Name, 'secrets')].Name" --output text)
if [[ "${S3_SECRETS_BUCKET:-null}" == "null" ]]; then
  echo >&2 "Couldn't determine S3_SECRETS_BUCKET"
  exit 1
fi

# Bucket region (may differ from instance region; KMS region comes from config.env AWS_REGION)
S3_SECRETS_REGION=$(aws s3api get-bucket-location --bucket "$S3_SECRETS_BUCKET" --query "LocationConstraint || 'us-east-1'" --output text)

# Build origin Docker image
docker build \
    -t "$TARGET_DOCKER_IMAGE" \
    --build-arg S3_SECRETS_BUCKET="$S3_SECRETS_BUCKET" \
    --build-arg S3_SECRETS_REGION="$S3_SECRETS_REGION" \
    -f ~ec2-user/enclave-service/Dockerfile \
    ~ec2-user/enclave-service/ \
;

# Free up memory for build-enclave
sudo sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service

sudo nitro-cli build-enclave \
    --docker-uri "$TARGET_DOCKER_IMAGE:latest" \
    --output-file "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif" \
;