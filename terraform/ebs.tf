resource "aws_ebs_volume" "enclave_instance_ebs" {
  availability_zone = "eu-west-1b"
  encrypted         = true
  final_snapshot    = true
  size              = 100 # snapshot_id or size is required
  kms_key_id        = aws_kms_key.enclave_instance_ebs_volume.arn

  tags = {
    Name = "${var.project_name}-ebs"
  }
}

resource "aws_volume_attachment" "ebs_att" {
  device_name = "/dev/sdh"
  volume_id   = aws_ebs_volume.enclave_instance_ebs.id
  instance_id = aws_instance.enclave_instance.id
}
