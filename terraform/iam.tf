# IAM role for the EC2 instance (Nitro Enclave parent)
resource "aws_iam_role" "enclave_instance_role" {
  name = "${var.project_name}-instance-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = "ec2.amazonaws.com"
        },
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# Associate the IAM role with the ACM certificate
resource "awscc_ec2_enclave_certificate_iam_role_association" "enclave_instance" {
  depends_on      = [aws_acm_certificate.apex, aws_acm_certificate_validation.apex]
  certificate_arn = aws_acm_certificate.apex.arn
  role_arn        = aws_iam_role.enclave_instance_role.arn
}

# Grant permissions to read the ACM certificate
resource "aws_iam_role_policy" "certificate_s3_read" {
  name = "AllowACMCertificateRead"
  role = aws_iam_role.enclave_instance_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "s3:GetObject",
        ],
        // TODO: We have to send this bucket to the enclave...
        Resource = "${awscc_ec2_enclave_certificate_iam_role_association.enclave_instance.certificate_s3_bucket_name}/*"
      }
    ]
  })
}

# Grant permissions to decrypt ACM certificates
resource "aws_iam_role_policy" "certificate_kms_decrypt" {
  name = "AllowACMCertificateDecrypt"
  role = aws_iam_role.enclave_instance_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "kms:Decrypt",
        ],
        // TODO: We have to send this AMS key to the enclave...
        Resource = awscc_ec2_enclave_certificate_iam_role_association.enclave_instance.encryption_kms_key_id
      }
    ]
  })
}

# Inline policy to allow the instance role to use the KMS key (defined in kms.tf)
resource "aws_iam_role_policy" "kms_access" {
  name = "AllowKMSUsage"
  role = aws_iam_role.enclave_instance_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*"
        ],
        Resource = aws_kms_key.enclave_instance_root_volume.arn
      }
    ]
  })
}

# Policy to allow EC2 instance to access DocumentDB
resource "aws_iam_role_policy" "docdb_access" {
  name = "AllowDocDBAccess"
  role = aws_iam_role.enclave_instance_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "rds:DescribeDBClusters",
          "rds:DescribeDBInstances",
          "rds:ListTagsForResource"
        ],
        Resource = "*"
      }
    ]
  })
}

# Instance profile to attach the role to the EC2 instance
resource "aws_iam_instance_profile" "enclave_instance_profile" {
  name = "${var.project_name}-instance-profile"
  role = aws_iam_role.enclave_instance_role.name
}

# Policy to read and write objects in the S3 bucket for secrets
resource "aws_iam_role_policy" "s3_access" {
  name = "AllowS3Access"
  role = aws_iam_role.enclave_instance_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:GetObjectVersion",
        ],
        Resource = [
          aws_s3_bucket.secrets.arn,
          "${aws_s3_bucket.secrets.arn}/*",
        ]
      }
    ]
  })
}
