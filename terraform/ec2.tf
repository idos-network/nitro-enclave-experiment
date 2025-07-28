# EC2 instance configuration for Nitro Enclave parent instance
data "aws_ami" "al2" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

resource "aws_instance" "enclave_instance" {
  ami                         = data.aws_ami.al2.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  associate_public_ip_address = true
  security_groups             = [aws_security_group.web_sg.id]
  iam_instance_profile        = aws_iam_instance_profile.enclave_instance_profile.name
  # Enable Nitro Enclaves on this instance
  enclave_options {
    enabled = true
  }
  # Optionally attach an SSH key pair if provided
  key_name                   = var.ec2_key_name != "" ? var.ec2_key_name : null

  # Cloud-init user data script to set up Nitro Enclave and Node.js server
  user_data = <<-EOF_USER
              #!/bin/bash
              set -xe

              # Install Nitro Enclaves CLI, development tools, Docker, and socat
              yum update -y
              amazon-linux-extras install -y aws-nitro-enclaves-cli
              yum install -y aws-nitro-enclaves-cli-devel docker socat

              # Enable Docker service
              systemctl enable --now docker

              # Configure Nitro Enclaves memory/CPU allocation
              # Increase enclave memory pool to 1024 MiB (default was 512 MiB)
              sed -i 's/memory_mib: 512/memory_mib: 1024/' /etc/nitro_enclaves/allocator.yaml || true
              # (cpu_count remains 2 as default, which is sufficient for this example)
              systemctl enable --now nitro-enclaves-allocator.service

              # Create enclave build directory
              mkdir -p /enclave

              # Write Dockerfile for enclave image
              cat > /enclave/Dockerfile << 'DOCKERFILE'
              FROM alpine:3.17
              # Install Node.js and socat
              RUN apk add --no-cache nodejs npm socat
              WORKDIR /app
              # Copy application files into the enclave image
              COPY app.js .
              COPY start.sh .
              RUN chmod +x start.sh
              # Set the startup command
              CMD ["./start.sh"]
              DOCKERFILE

              # Write Node.js application (Hello World server)
              cat > /enclave/app.js << 'NODEAPP'
              const http = require('http');
              const port = process.env.PORT || 3000;
              const server = http.createServer((req, res) => {
                res.writeHead(200, {'Content-Type': 'text/plain'});
                res.end('Hello from Nitro Enclave!\n');
              });
              server.listen(port, '127.0.0.1', () => {
                console.log(`Server running on port ${port}`);
              });
              NODEAPP

              # Write enclave startup script
              cat > /enclave/start.sh << 'STARTSH'
              #!/bin/sh
              # Start Node.js app in the background
              node /app/app.js &
              # Forward enclave vsock port 5005 to the Node app port 3000
              exec socat VSOCK-LISTEN:5005,fork TCP:127.0.0.1:3000
              STARTSH
              chmod +x /enclave/start.sh

              # Build the enclave Docker image and create an Enclave Image File (EIF)
              docker build -t hello-enclave:latest /enclave
              nitro-cli build-enclave --docker-uri hello-enclave:latest --output-file /enclave/hello.eif

              # Run the enclave with 1024 MiB memory and 2 vCPUs, specify vsock CID 16
              nitro-cli run-enclave --eif-path /enclave/hello.eif --memory 1024 --cpu-count 2 --enclave-cid 16 --debug-mode

              # Start socat on the host to forward TCP:80 to enclave vsock:5005
              socat TCP-LISTEN:80,reuseaddr,fork VSOCK-CONNECT:16:5005 &
              EOF_USER

  tags = {
    Name = "${var.project_name}-instance"
  }
}
