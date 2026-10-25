#!/bin/bash
# shellcheck shell=dash

# kms_decrypt <base64 ciphertext> - prints the base64 plaintext.
#
# With kmstool_enclave_cli in the image (enclave-service) the Decrypt request carries this
# enclave's attestation document from /dev/nsm as Recipient. KMS then returns the plaintext
# only encrypted to the attestation's ephemeral key (CiphertextForRecipient), which kmstool
# opens inside the enclave, and the key policy can require kms:RecipientAttestation:PCR0-2.
# kmstool dials the host's KMS vsock proxy itself (CID 3, $KMS_PROXY_PORT), not the
# 127.0.0.5 socat. Images without it (entropy, facesign) keep the plain host-role call.
kms_decrypt() {
  if ! command -v kmstool_enclave_cli > /dev/null; then
    aws kms decrypt --ciphertext-blob "$1" --output text --query Plaintext --region "$AWS_REGION"
    return
  fi

  # Host instance-role credentials (IMDS over the vsock proxy); kmstool signs with them.
  local credentials
  credentials=$(aws configure export-credentials --format process)

  kmstool_enclave_cli decrypt \
    --region "$AWS_REGION" \
    --proxy-port "$KMS_PROXY_PORT" \
    --aws-access-key-id "$(echo "$credentials" | jq -r .AccessKeyId)" \
    --aws-secret-access-key "$(echo "$credentials" | jq -r .SecretAccessKey)" \
    --aws-session-token "$(echo "$credentials" | jq -r .SessionToken)" \
    --ciphertext "$1" \
    | sed -n 's/^PLAINTEXT: //p'
}
