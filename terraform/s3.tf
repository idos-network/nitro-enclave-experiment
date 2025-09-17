resource "aws_s3_bucket" "secrets" {
  bucket = "${var.project_name}-secrets"
}

resource "aws_s3_bucket_versioning" "secrets_versioning" {
  bucket = aws_s3_bucket.secrets.id

  versioning_configuration {
    status = "Enabled"
  }
}
