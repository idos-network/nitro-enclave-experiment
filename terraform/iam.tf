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

# Attach AWS managed policy for SSM (Session Manager) access
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.enclave_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
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
        Resource = aws_kms_key.enclave_key.arn
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
