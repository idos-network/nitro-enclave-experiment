#!/bin/ash
# shellcheck shell=dash
set -u
set -o pipefail

TARGET_DOCKER_IMAGE=idos-facetec

# Set allocation for enclave operation
sudo sed -i 's/^memory_mib:.*/memory_mib: 36000/' /etc/nitro_enclaves/allocator.yaml
sudo sed -i 's/^cpu_count:.*/cpu_count: 8/' /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service

# Run the EIF
# The CID being 16 is arbitrary.
sudo nitro-cli run-enclave \
    --enclave-cid 16 \
    --cpu-count 8 \
    --memory 36000 \
    --eif-path "$NITRO_CLI_ARTIFACTS/$TARGET_DOCKER_IMAGE.eif" \
    --attach-console \
;
