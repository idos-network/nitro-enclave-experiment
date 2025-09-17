resource "aws_kms_key" "enclave_instance_root_volume" {
  description = "Key for Nitro Enclave attestation demo"
}

resource "aws_kms_alias" "enclave_instance_root_volume_alias" {
  name          = "alias/enclaveInstanceRootVolume"
  target_key_id = aws_kms_key.enclave_instance_root_volume.key_id
}

data "aws_iam_policy_document" "kms_nitro_enclave" {
  statement {
    sid    = "AllowRootAdminOnly"
    effect = "Allow"

    principals {
      type = "AWS"
      identifiers = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
      ]
    }

    actions = [
      "kms:DescribeKey",
      "kms:List*",
      "kms:GetKeyPolicy",
      "kms:GetKeyRotationStatus",
      "kms:DisableKey",
      "kms:EnableKey",
      "kms:EnableKeyRotation",
      "kms:CreateAlias",
      "kms:UpdateAlias",
      "kms:PutKeyPolicy",
      "kms:ScheduleKeyDeletion",
      "kms:CancelKeyDeletion",
    ]

    resources = ["*"]
  }

  statement {
    sid    = "AllowEC2InstanceRoleUseOfKey"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.enclave_instance_role.arn]
    }

    actions = [
      "kms:Encrypt",
      "kms:DescribeKey",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
    ]

    resources = ["*"]
  }
}

resource "aws_kms_key" "enclave_instance_ebs_volume" {
  description = "Key for Nitro Enclave EBS volume"
  policy      = data.aws_iam_policy_document.kms_nitro_enclave.json
}

resource "aws_kms_key" "secrets_encryption" {
  description             = "Key for SOPS secrets decryption in Nitro Enclave"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = data.aws_iam_policy_document.kms_nitro_enclave.json
}

resource "aws_kms_alias" "secrets_encryption" {
  name          = "alias/secretsEncryption"
  target_key_id = aws_kms_key.secrets_encryption.key_id
}

resource "aws_kms_key" "secrets_facetec_encryption" {
  description             = "Key for Facetec private key encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = data.aws_iam_policy_document.kms_nitro_enclave.json
}

resource "aws_kms_alias" "secrets_facetec_encryption" {
  name          = "alias/secretsFacetecEncryption"
  target_key_id = aws_kms_key.secrets_facetec_encryption.key_id
}
