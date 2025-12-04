#!/bin/ash
# shellcheck shell=dash
set -u
set -o pipefail

TARGET_DOCKER_IMAGE=idos-facetec

# Cleanup. This is ok to fail and proceed.
sudo nitro-cli terminate-enclave --all
sudo rm -rf /tmp/??????????
sudo rm -f "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif"

set -e

# Load building configuration
FACETEC_SDK_VERSION="10.0.25"

S3_SECRETS_BUCKET=$(aws s3api list-buckets --query "Buckets[?contains(Name, 'facesign') && contains(Name, 'secrets')].Name" --output text)
if [[ "${S3_SECRETS_BUCKET:-null}" == "null" ]]; then
    echo >&2 "Couldn't determine S3_SECRETS_BUCKET"
    exit 1
fi

FACETEC_SDK_BUCKET=$(aws s3api list-buckets --query "Buckets[?contains(Name, 'facesign') && contains(Name, 'facetec-sdk')].Name" --output text)
if [[ "${FACETEC_SDK_BUCKET:-null}" == "null" ]]; then
    echo >&2 "Couldn't determine FACETEC_SDK_BUCKET"
    exit 1
fi

# Replace placeholders in Dockerfile
sed -i "s/INSERT_FACETEC_SDK_VERSION_HERE/$FACETEC_SDK_VERSION/g" ~ec2-user/server/facesign-service/Dockerfile
sed -i "s/INSERT_S3_SECRETS_BUCKET_HERE/$S3_SECRETS_BUCKET/g" ~ec2-user/server/facesign-service/Dockerfile
sed -i "s/INSERT_FACETEC_SDK_BUCKET_HERE/$FACETEC_SDK_BUCKET/g" ~ec2-user/server/facesign-service/Dockerfile

# Build origin Docker image
docker build \
    -t "$TARGET_DOCKER_IMAGE" \
    -f ~ec2-user/server/facesign-service/Dockerfile \
    ~ec2-user/server/ \
;

# Free up memory for build-enclave
sudo sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service

sudo nitro-cli build-enclave \
    --docker-uri "$TARGET_DOCKER_IMAGE:latest" \
    --output-file "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif" \
;
