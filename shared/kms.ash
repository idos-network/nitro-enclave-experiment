#!/bin/bash
# shellcheck shell=dash

# kms_decrypt <base64 ciphertext> - prints the base64 plaintext.
#
# With the NSM addon in the image (enclave-service) the Decrypt request carries this
# enclave's attestation document from /dev/nsm as Recipient. KMS then returns the plaintext
# only encrypted to the attestation's ephemeral key (CiphertextForRecipient), which
# packages/nitro-nsm/kms-decrypt.ts opens inside the enclave, and the key policy can require
# kms:RecipientAttestation:PCR0-2. Images without the addon (entropy, facesign, proxy) keep
# the plain host-role call.
kms_decrypt() {
  if [ -f /app/packages/nitro-nsm/nitro-nsm.node ]; then
    node /app/packages/nitro-nsm/kms-decrypt.ts "$1"
  else
    aws kms decrypt --ciphertext-blob "$1" --output text --query Plaintext --region "$AWS_REGION"
  fi
}
