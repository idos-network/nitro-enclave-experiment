// TODO: I am keeping the config, since we will need them... it really depens on how we get the password for luks
resource "aws_s3_bucket" "config" {
  bucket = "${var.project_name}-config"
}

resource "aws_s3_bucket_versioning" "config_versioning" {
  bucket = aws_s3_bucket.config.id

  versioning_configuration {
    status = "Enabled"
  }
}
