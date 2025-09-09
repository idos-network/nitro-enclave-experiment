resource "aws_s3_bucket" "usage_logs" {
  bucket = "nitro-enclave-usage-logs"
}

resource "aws_s3_bucket_versioning" "usage_logs_versioning" {
  bucket = aws_s3_bucket.usage_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket" "three_d_db" {
  bucket = "nitro-enclave-3d-db"
}

resource "aws_s3_bucket_versioning" "three_d_db_versioning" {
  bucket = aws_s3_bucket.three_d_db.id

  versioning_configuration {
    status = "Enabled"
  }
}
