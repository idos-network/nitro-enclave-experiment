#!/bin/ash
# shellcheck shell=dash
set -u
set -o pipefail

TARGET_DOCKER_IMAGE=idos-entropy

# Cleanup. This is ok to fail and proceed.
sudo nitro-cli terminate-enclave --all
sudo rm -rf /tmp/??????????
sudo rm -f "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif"

set -e

MONGO_HOST="$(aws docdb describe-db-clusters --region eu-west-1 | jq -r .DBClusters[0].Endpoint)"
if [ "${MONGO_HOST:-null}" = "null" ]; then
    echo >&2 "Couldn't determine MONGO_HOST"
    exit 1
fi

# Get FLE keys
AWS_KMS_FLE_KEY_ID="$(aws kms describe-key --key-id alias/entropyFleEncryption --query 'KeyMetadata.Arn' --output text --region eu-west-1)"

sudo cp ~ec2-user/.ssh/authorized_keys ~ec2-user/entropy-service/
sudo chown ec2-user:ec2-user ~ec2-user/entropy-service/authorized_keys

S3_SECRETS_BUCKET=$(aws s3api list-buckets --query "Buckets[?contains(Name, 'facesign') && contains(Name, 'secrets')].Name" --output text)
if [[ "${S3_SECRETS_BUCKET:-null}" == "null" ]]; then
    echo >&2 "Couldn't determine S3_SECRETS_BUCKET"
    exit 1
fi

# Build origin Docker image
docker build \
    --build-arg MONGO_HOST="$MONGO_HOST" \
    --build-arg AWS_KMS_FLE_KEY_ID="$AWS_KMS_FLE_KEY_ID" \
    --build-arg S3_SECRETS_BUCKET="$S3_SECRETS_BUCKET" \
    -t "$TARGET_DOCKER_IMAGE" \
    -f ~ec2-user/entropy-service/Dockerfile \
    ~ec2-user/entropy-service/ \
;

# Free up memory for build-enclave
sudo sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service

sudo nitro-cli build-enclave \
    --docker-uri "$TARGET_DOCKER_IMAGE:latest" \
    --output-file "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif" \
;
