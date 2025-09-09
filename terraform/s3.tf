resource "aws_s3_bucket" "usage_logs" {
  bucket = "${var.project_name}-usage-logs"
}

resource "aws_s3_bucket_versioning" "usage_logs_versioning" {
  bucket = aws_s3_bucket.usage_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket" "three_d_db" {
  bucket = "${var.project_name}-3d-db"
}

resource "aws_s3_bucket_versioning" "three_d_db_versioning" {
  bucket = aws_s3_bucket.three_d_db.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket" "config" {
  bucket = "${var.project_name}-config"
}

resource "aws_s3_bucket_versioning" "config_versioning" {
  bucket = aws_s3_bucket.config.id

  versioning_configuration {
    status = "Enabled"
  }
}
