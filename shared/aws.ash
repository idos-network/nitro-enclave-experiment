#!/bin/bash
# shellcheck shell=dash

# AWS calls of the boot scripts. enclave, entropy and proxy run them with the node CLI of
# @idos/nitro-nsm (packages/nitro-nsm/aws.ts) and ship no AWS CLI; facesign still has AWS CLI v2.
AWS_NODE_CLI=/app/packages/nitro-nsm/aws.ts

has_aws_cli() {
  command -v aws > /dev/null
}

# s3_get <key> <file> - from the secrets bucket, fails if the object can't be read
s3_get() {
  if has_aws_cli; then
    aws s3 cp "s3://$S3_SECRETS_BUCKET/$1" "$2" --region "$S3_SECRETS_REGION"
  else
    AWS_REGION="$S3_SECRETS_REGION" node "$AWS_NODE_CLI" s3-get "$S3_SECRETS_BUCKET" "$1" "$2"
  fi
}

# s3_put_new <key> <file> - into the secrets bucket with If-None-Match: *, never overwrites
s3_put_new() {
  if has_aws_cli; then
    aws s3api put-object --bucket "$S3_SECRETS_BUCKET" --key "$1" \
      --body "$2" --if-none-match '*' --region "$S3_SECRETS_REGION"
  else
    AWS_REGION="$S3_SECRETS_REGION" node "$AWS_NODE_CLI" s3-put-new "$S3_SECRETS_BUCKET" "$1" "$2"
  fi
}

# kms_encrypt <key arn> <base64 plaintext> - prints the base64 ciphertext
kms_encrypt() {
  if has_aws_cli; then
    aws kms encrypt --key-id "$1" --plaintext "$2" \
      --cli-binary-format base64 --output text --query CiphertextBlob --region "$AWS_REGION"
  else
    node "$AWS_NODE_CLI" kms-encrypt "$1" "$2"
  fi
}

# kms_decrypt <base64 ciphertext> - prints the base64 plaintext.
#
# With the NSM addon in the image (enclave-service, proxy-service) aws.ts sends this enclave's
# attestation document from /dev/nsm as Recipient. KMS then returns the plaintext only
# encrypted to the attestation's ephemeral key (CiphertextForRecipient), which
# packages/nitro-nsm/kms-decrypt.ts opens inside the enclave, and the key policy can require
# kms:RecipientAttestation:PCR0-2. Images without the addon (entropy, facesign) make
# the plain host-role call.
kms_decrypt() {
  if has_aws_cli; then
    aws kms decrypt --ciphertext-blob "$1" --output text --query Plaintext --region "$AWS_REGION"
  else
    node "$AWS_NODE_CLI" kms-decrypt "$1"
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
  if ! s3_get "$SERVICE_NAME/$ENC_FILE" "$ENC_FILE"; then
    echo "-> Couldn't download $ENC_FILE from S3, generating a new one"
    kms_encrypt "$KMS_KEY_ARN" "$(eval "$GENERATE")" > "$ENC_FILE"
    # A failed download isn't proof the key is missing: never overwrite an existing one
    s3_put_new "$SERVICE_NAME/$ENC_FILE" "$ENC_FILE"
  fi

  mkdir -p -m 700 /run/secrets
  kms_decrypt "$(cat "$ENC_FILE")" > "/run/secrets/$NAME"
}
