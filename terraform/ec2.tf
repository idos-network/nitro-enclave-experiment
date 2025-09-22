# EC2 instance configuration for Nitro Enclave parent instance
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-202*.*.*-kernel-6.12-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_key_pair" "enclave" {
  key_name   = "enclave"
  public_key = var.ssh_key
}

resource "aws_instance" "enclave_instance" {
  ami                         = data.aws_ami.amazon_linux_2023.id
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.web_sg.id]
  iam_instance_profile        = aws_iam_instance_profile.enclave_instance_profile.name

  enclave_options {
    enabled = true
  }

  key_name = aws_key_pair.enclave.key_name

  root_block_device {
    encrypted             = true
    kms_key_id            = aws_kms_key.enclave_instance_root_volume.arn
    delete_on_termination = true
    volume_size           = 96

    tags = {
      Name = "${var.project_name}-root"
    }
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
    type  = "ssh"
    user  = "ec2-user"
    host  = self.public_ip
    agent = true
  }

  provisioner "remote-exec" {
    inline = ["sudo cloud-init status --wait"]
  }
}
