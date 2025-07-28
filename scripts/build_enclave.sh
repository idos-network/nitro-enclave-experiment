#!/bin/bash
# build_enclave.sh - Build the Docker image and Nitro Enclave EIF
set -xe

# Build the enclave Docker image from the Dockerfile and application files
docker build -t hello-enclave:latest enclave/

# Create the Enclave Image File (EIF) from the Docker image
nitro-cli build-enclave --docker-uri hello-enclave:latest --output-file enclave/hello.eif

# (Optional) Output enclave image details and PCR measurements for attestation
nitro-cli describe-eif --eif-path enclave/hello.eif

echo "Enclave image build complete. EIF saved to enclave/hello.eif"
