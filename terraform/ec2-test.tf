resource "aws_instance" "enclave_instance_test" {
  ami                         = data.aws_ami.al2.id
  instance_type               = "m6i.2xlarge"
  subnet_id                   = data.aws_subnets.default.ids[0]
  associate_public_ip_address = true
  security_groups             = [aws_security_group.web_sg.name]
  iam_instance_profile        = aws_iam_instance_profile.enclave_instance_profile.name

  enclave_options {
    enabled = true
  }

  key_name = aws_key_pair.enclave_key.key_name

  root_block_device {
    delete_on_termination = true
    volume_size           = 256
  }

  # Cloud-init user data script to set up Nitro Enclave and Node.js server
  user_data = file("${path.module}/user_data.sh")

  lifecycle {
    ignore_changes = [user_data]
  }

  tags = {
    Name = "${var.project_name}-instance-test"
  }

  connection {
    type  = "ssh"
    user  = "ec2-user"
    host  = self.public_ip
    agent = true
  }

  provisioner "remote-exec" {
    inline = ["sudo cloud-init status --wait"]
  }
}
