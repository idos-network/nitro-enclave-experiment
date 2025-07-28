# KMS key for use with Nitro Enclaves (e.g., for attestation and secret decryption)
resource "aws_kms_key" "enclave_key" {
  description = "Key for Nitro Enclave attestation demo"
  policy = jsonencode({
    Version = "2012-10-17",
    Id      = "enclave-kms-key-policy",
    Statement = [
      {
        Sid    = "AllowRootAccount",
        Effect = "Allow",
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" },
        Action   = "kms:*",
        Resource = "*"
      },
      {
        Sid    = "AllowInstanceRoleUse",
        Effect = "Allow",
        Principal = { AWS = aws_iam_role.enclave_instance_role.arn },
        Action   = [ "kms:Decrypt", "kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*" ],
        Resource = "*"
        # In a real scenario, add conditions here (e.g., kms:RecipientAttestation:ImageSha384) to restrict usage to a specific enclave measurement.
      }
    ]
  })
}

# Friendly alias for the KMS key
resource "aws_kms_alias" "enclave_key_alias" {
  name          = "alias/nitroEnclaveKey"
  target_key_id = aws_kms_key.enclave_key.key_id
}
