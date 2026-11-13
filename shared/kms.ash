#!/bin/bash
# shellcheck shell=dash

# kms_decrypt <base64 ciphertext> - prints the base64 plaintext.
#
# With the NSM addon in the image (enclave-service, proxy-service) the Decrypt request carries this
# enclave's attestation document from /dev/nsm as Recipient. KMS then returns the plaintext
# only encrypted to the attestation's ephemeral key (CiphertextForRecipient), which
# packages/nitro-nsm/kms-decrypt.ts opens inside the enclave, and the key policy can require
# kms:RecipientAttestation:PCR0-2. Images without the addon (entropy, facesign) keep
# the plain host-role call.
kms_decrypt() {
  if [ -f /app/packages/nitro-nsm/nitro-nsm.node ]; then
    node /app/packages/nitro-nsm/kms-decrypt.ts "$1"
  else
    aws kms decrypt --ciphertext-blob "$1" --output text --query Plaintext --region "$AWS_REGION"
  fi
}

# generate_once <service> <name> <kms key arn> <command printing the base64 plaintext>
#
# Like the LUKS password, the secret is generated on first boot, KMS-encrypted into S3 as
# <service>/<name>.enc and decrypted (kms_decrypt, with attestation where the image has the
# addon) into /run/secrets/<name>, which like all but /mnt/encrypted is enclave RAM. With a
# PCR-restricted key the plaintext only ever exists inside an attested enclave.
generate_once() {
  local SERVICE_NAME=$1 NAME=$2 KMS_KEY_ARN=$3 GENERATE=$4
  local ENC_FILE="$NAME.enc"

  echo "-> Fetching $NAME from S3"
  if ! aws s3 cp "s3://$S3_SECRETS_BUCKET/$SERVICE_NAME/$ENC_FILE" "$ENC_FILE" --region "$S3_SECRETS_REGION"; then
    echo "-> Couldn't download $ENC_FILE from S3, generating a new one"
    aws kms encrypt --key-id "$KMS_KEY_ARN" --plaintext "$(eval "$GENERATE")" \
      --cli-binary-format base64 --output text --query CiphertextBlob --region "$AWS_REGION" > "$ENC_FILE"
    # A failed download isn't proof the key is missing: never overwrite an existing one
    aws s3api put-object --bucket "$S3_SECRETS_BUCKET" --key "$SERVICE_NAME/$ENC_FILE" \
      --body "$ENC_FILE" --if-none-match '*' --region "$S3_SECRETS_REGION"
  fi

  mkdir -p -m 700 /run/secrets
  kms_decrypt "$(cat "$ENC_FILE")" > "/run/secrets/$NAME"
}
