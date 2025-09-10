# KMS key for use with Nitro Enclaves (e.g., for attestation and secret decryption)
resource "aws_kms_key" "enclave_key" {
  description = "Key for Nitro Enclave attestation demo"
  policy = jsonencode({
    Version = "2012-10-17",
    Id      = "enclave-kms-key-policy",
    Statement = [
      {
        Sid       = "AllowRootAccount",
        Effect    = "Allow",
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" },
        Action    = "kms:*",
        Resource  = "*"
      },
      {
        Sid       = "AllowInstanceRoleUse",
        Effect    = "Allow",
        Principal = { AWS = aws_iam_role.enclave_instance_role.arn },
        Action    = ["kms:Decrypt", "kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
        Resource  = "*"
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

# GoCryptFS key for encrypting files stored in S3
resource "aws_kms_key" "gocryptfs" {
  description             = "Key for gocryptfs on EC2"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Id      = "gocryptfs-key-policy"
    Statement = [
      # --- ADMIN: root can only delete the key, but not use it ---
      {
        Sid    = "AllowRootAdminOnly"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action = [
          "kms:DescribeKey",
          "kms:List*",
          "kms:GetKeyPolicy",
          "kms:GetKeyRotationStatus",
          "kms:DisableKey",
          "kms:EnableKey",
          // We have to set this otherwise we cannot create a policy
          // for this key:
          // AWS operation error KMS: PutKeyPolicy, https response error StatusCode: 400, RequestID: 87120d0e-2a77-40ad-86cd-e1a750f9d6e5, MalformedPolicyDocumentException: The new key policy will not allow you to update the key policy in the future.
          "kms:PutKeyPolicy",
          "kms:ScheduleKeyDeletion",
          "kms:CancelKeyDeletion"
        ]
        Resource = "*"
      },

      # --- USAGE: only EC2 instance role ---
      {
        Sid    = "AllowEC2InstanceRoleUseOfKey"
        Effect = "Allow"
        Principal = {
          AWS = "${aws_iam_role.enclave_instance_role.arn}"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "gocryptfs" {
  name          = "alias/gocryptfs"
  target_key_id = aws_kms_key.gocryptfs.key_id
}
