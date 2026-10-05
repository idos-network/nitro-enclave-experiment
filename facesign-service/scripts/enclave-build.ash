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
FACETEC_SDK_VERSION="10.1.21"

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

# Bucket region (may differ from instance region; KMS region comes from config.env AWS_REGION)
S3_SECRETS_REGION=$(aws s3api get-bucket-location --bucket "$S3_SECRETS_BUCKET" --query "LocationConstraint || 'us-east-1'" --output text)
FACETEC_SDK_REGION=$(aws s3api get-bucket-location --bucket "$FACETEC_SDK_BUCKET" --query "LocationConstraint || 'us-east-1'" --output text)

# Build origin Docker image
docker build \
    -t "$TARGET_DOCKER_IMAGE" \
    --build-arg FACETEC_SDK_VERSION="$FACETEC_SDK_VERSION" \
    --build-arg FACETEC_SDK_BUCKET="$FACETEC_SDK_BUCKET" \
    --build-arg FACETEC_SDK_REGION="$FACETEC_SDK_REGION" \
    --build-arg S3_SECRETS_BUCKET="$S3_SECRETS_BUCKET" \
    --build-arg S3_SECRETS_REGION="$S3_SECRETS_REGION" \
    -f ~ec2-user/facesign-service/Dockerfile \
    ~ec2-user/facesign-service/ \
;

# Free up memory for build-enclave
sudo sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service

sudo nitro-cli build-enclave \
    --docker-uri "$TARGET_DOCKER_IMAGE:latest" \
    --output-file "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif" \
;
