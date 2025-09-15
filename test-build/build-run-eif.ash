#!/bin/ash
# shellcheck shell=dash
set -u
set -o pipefail

TARGET_DOCKER_IMAGE=idos-test

# Cleanup. This is ok to fail and proceed.
sudo nitro-cli terminate-enclave --all
sudo rm -rf /tmp/??????????
sudo rm -f "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif"

set -e

# TODO(pkoch): Add the fs.key.enc file here. How?
sudo cp ~ec2-user/.ssh/authorized_keys ~ec2-user/test-build/
sudo chown ec2-user:ec2-user ~ec2-user/test-build/authorized_keys

# Build origin Docker image
docker build \
    -t "$TARGET_DOCKER_IMAGE" \
    -f ~ec2-user/test-build/Dockerfile."$TARGET_DOCKER_IMAGE" \
    ~ec2-user/test-build/ \
;

# Free up memory for build-enclave
sudo sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service

sudo nitro-cli build-enclave \
    --docker-uri "$TARGET_DOCKER_IMAGE:latest" \
    --output-file "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif" \
;

# Set allocation for enclave operation
sudo sed -i 's/^memory_mib:.*/memory_mib: 4096/' /etc/nitro_enclaves/allocator.yaml
sudo sed -i 's/^cpu_count:.*/cpu_count: 2/' /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service

# Run the EIF
# The CID being 16 is arbitrary.
sudo nitro-cli run-enclave \
    --enclave-cid 16 \
    --cpu-count 2 \
    --memory 4096 \
    --eif-path "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif" \
    --attach-console \
;
