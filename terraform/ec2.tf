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
    ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC4XA1ByL8X1ft9Bi/HAWKouJRbH4VezCqBJSZhSj7fGeipuvfN3oR4KIIbp7lkrJ8lKNyarnAVSVYM4ZofbVJOEs20L4nHXyEzqowIe6p+03dcDb/BL7BnoOL9xeKMJpsLj75hSLcuZ6mpCXj4OGRGRW3TNnlFmNS3ukMHyhaD0lezrfdsfIVbB3sXO9Vo/dKcfRCYISgspJ0MkEVOr2z141wWXvg467JYptJ+lMRJ76zZaMtSVHsxf6OJNg0yGcgka/BYch17YV04mNWa3rpqoF31muJBayalYUXoNP1QIuqL3i65LMqvwIKY9Yr9HY9ShqxA7SWRYuanLpq2PBRsJmVilyHLdNwDdxLxiHDJKai6xxNvEbj2wRial+UOjv7dEiZM92bzlvdlQNZWknDIFfvN7UuPn2iB/BE6NypzwU6SCGWd6Cx6P8tp0Z445YR9fJJIK3PN+QIa5RHzfnPY/erZnSi5lqr/I+DiaC6JON8WqltjbuPEwAovIPvlOIpv/munXnXIvgfT7BE1xxqwVLwwdDvq+cDfhopPhuHj1EA7Pj2xIs6Kf5rAAOBjcBuFky+JsUg/Aj7KFSIOvMOdAstM18y376qAlqtETE35lKhIQtyaPX3Xer7tDl/m80DpYNRUB2PNVb/gHIjJ1tcbR+Rs1sO5l9WaSlJzQjVU1w== jan.strnadek@gmail.com
  EOF
}

resource "aws_instance" "enclave_instance" {
  ami                         = data.aws_ami.al2.id
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  associate_public_ip_address = true
  security_groups             = [aws_security_group.web_sg.id]
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
    type  = "ssh"
    user  = "ec2-user"
    host  = self.public_ip
    agent = true
  }

  provisioner "remote-exec" {
    inline = ["sudo cloud-init status --wait"]
  }
}
