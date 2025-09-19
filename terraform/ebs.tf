resource "aws_ebs_volume" "enclave_instance_encrypted_volume" {
  availability_zone = "eu-west-1b"
  encrypted         = true
  final_snapshot    = true
  size              = 100 # snapshot_id or size is required
  kms_key_id        = aws_kms_key.enclave_instance_encrypted_volume.arn

  tags = {
    Name = "${var.project_name}-encrypted"
  }
}

resource "aws_volume_attachment" "encrypted_volume_attachment" {
  device_name = "/dev/sdh"
  volume_id   = aws_ebs_volume.enclave_instance_encrypted_volume.id
  instance_id = aws_instance.enclave_instance.id
}
