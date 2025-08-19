# EC2 instance configuration for Nitro Enclave parent instance
data "aws_ami" "al2" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

resource "aws_key_pair" "enclave_key" {
  key_name   = "pkoch"
  public_key = <<-EOF
    ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFL6hLKdv79gkutmidbynYvDR37Ko9PYe1GAaI0iM30N
  EOF
}

resource "aws_instance" "enclave_instance" {
  ami                         = data.aws_ami.al2.id
  instance_type               = var.instance_type
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
    Name = "${var.project_name}-instance"
  }

  connection {
    type = "ssh"
    user = "ec2-user"
    host = self.public_ip
  }

  provisioner "remote-exec" {
    inline = ["sudo cloud-init status --wait"]
  }
}
