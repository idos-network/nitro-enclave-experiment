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

MONGO_HOST="$(aws docdb describe-db-clusters --region eu-west-1 | jq -r .DBClusters[0].Endpoint)"
if [ "${MONGO_HOST:-null}" = "null" ]; then
    echo >&2 "Couldn't determine MONGO_HOST"
    exit 1
fi

# Get the FaceTec SDK version
FACETEC_SDK_VERSION="$(find ~ec2-user/custom-server/ -name 'FaceTecSDK-Server-Core-*.jar' | sed -E 's#.*/FaceTecSDK-Server-Core-([[:digit:]]+\.[[:digit:]]+\.[[:digit:]]+).jar#\1#')"
AWS_KMS_SECRETS_KEY_ID="$(aws kms describe-key --key-id alias/secretsEncryption --query 'KeyMetadata.Arn' --output text --region eu-west-1)"
AWS_KMS_SECRETS_FACETEC_KEY_ID="$(aws kms describe-key --key-id alias/secretsFacetecEncryption --query 'KeyMetadata.Arn' --output text --region eu-west-1)"

sudo cp ~ec2-user/.ssh/authorized_keys ~ec2-user/custom-server/
sudo chown ec2-user:ec2-user ~ec2-user/custom-server/authorized_keys

# Build origin Docker image
docker build \
    --build-arg MONGO_HOST="$MONGO_HOST" \
    --build-arg FACETEC_SDK_VERSION="$FACETEC_SDK_VERSION" \
    --build-arg AWS_KMS_SECRETS_KEY_ID="$AWS_KMS_SECRETS_KEY_ID" \
    --build-arg AWS_KMS_SECRETS_FACETEC_KEY_ID="$AWS_KMS_SECRETS_FACETEC_KEY_ID" \
    -t "$TARGET_DOCKER_IMAGE" \
    -f ~ec2-user/custom-server/Dockerfile."$TARGET_DOCKER_IMAGE" \
    ~ec2-user/custom-server/ \
;

# Free up memory for build-enclave
sudo sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service

sudo nitro-cli build-enclave \
    --docker-uri "$TARGET_DOCKER_IMAGE:latest" \
    --output-file "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif" \
;
