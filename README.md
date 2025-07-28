# Hello World Nitro Enclave Webserver

## Overview
This project provisions an AWS EC2 instance with Nitro Enclaves support and runs a Node.js "Hello World" webserver inside a Nitro Enclave. The EC2 instance acts as the bridge between the outside world and the enclave. The Node.js server listens within the enclave, and the parent EC2 instance forwards HTTP traffic to the enclave via a vsock (virtual socket) proxy. Nitro Enclaves provide an isolated execution environment with no direct network access, so we use the instance as a proxy (using `socat`) to forward incoming requests to the enclave.

All infrastructure is managed with Terraform: a VPC, subnet, security group, IAM role, and an EC2 instance configured for enclaves. The EC2's user data script installs Nitro Enclaves CLI and Docker, builds the enclave image, and starts the enclave and the vsock proxy automatically on boot. A KMS key is also provisioned (which can be used for enclave attestation if needed).

## Architecture
- **VPC & Networking:** A new VPC with a public subnet is created. An Internet Gateway and route are configured to allow internet access. The EC2 instance is launched in this subnet with a public IP address. A Security Group opens port 80 (HTTP) to the world for our web server.
- **EC2 Instance:** An Amazon Linux 2 EC2 instance (Nitro-based type) is configured with Nitro Enclaves enabled. The instance's user data script handles installation of Nitro Enclaves CLI and Docker, enclave image build, enclave launch, and traffic forwarding. The instance has an IAM role that permits it to use AWS KMS for attestation (if implemented) and AWS Systems Manager (for optional access).
- **Nitro Enclave:** The enclave is built from a Docker image defined in the `enclave/` directory. It contains a minimal Linux, Node.js runtime, and a simple Node.js server (`app.js`) that responds with "Hello from Nitro Enclave!" on port 3000 inside the enclave. Because enclaves have no external networking, the server is not directly accessible. Instead, it listens on the enclave's loopback interface, and we use vsock for communication.
- **Vsock Proxy:** To expose the enclave's service, the host EC2 instance runs a vsock <-> TCP proxy. We use the `socat` utility on the parent instance to listen on TCP port 80 and forward connections to the enclave's vsock port. Inside the enclave, the Node.js app is paired with a `socat` process (via the `start.sh` script) that listens on the enclave's vsock port and forwards to the local Node.js port. This double proxy allows external clients to connect via standard TCP, while communication into the enclave happens over the vsock interface (the only communication channel between an enclave and its parent).
- **AWS KMS Integration:** A KMS key is created which could be used for secure attestation. The EC2 instance's IAM role is given permission to use this key. In a real scenario, you would configure the KMS key policy with Nitro Enclaves attestation condition keys (like the enclave's PCR hash) to restrict decryption to a specific enclave measurement. This example includes the key and basic permissions but does not pass any secret; it's in place to show how you'd wire up attestation if needed.

## Deployment Instructions
1. **Prerequisites:** Ensure you have [Terraform](https://terraform.io) installed and AWS credentials configured (via environment variables or AWS config file). You also need an AWS account with permissions to create the resources (EC2, VPC, IAM, KMS).
2. **Nitro Enclaves Support:** Make sure to deploy in an AWS region and use an instance type that supports Nitro Enclaves (e.g., `c5.xlarge`, `m5.xlarge`, etc., which have 4+ vCPUs). This Terraform is defaulted to such an instance type. Nitro Enclaves is enabled on the instance via Terraform (the `enclave_options` setting). The instance will allocate memory and CPUs for enclaves (by default 512 MiB and 2 vCPUs are preallocated; we increase it to 1024 MiB in the user data for our enclave).
3. **Initialize and Apply Terraform:** Navigate to the `terraform/` directory and run:
   ```bash
   terraform init
   terraform apply -auto-approve
   ```
   Terraform will provision all resources. On completion, it will output the public IP of the EC2 instance as `ec2_public_ip` (among other outputs).
4. **Access the Hello World Webserver:** Once apply is complete, the EC2 user data will have automatically built and launched the Nitro enclave. You can test the web server by visiting `http://<EC2_PUBLIC_IP>` in your browser or via curl:
   ```bash
   curl http://<EC2_PUBLIC_IP>
   ```
   You should receive the response: "Hello from Nitro Enclave!" This response is served by the Node.js application running inside the enclave, proving that the enclave is handling the HTTP request (relayed through the EC2 host).
5. **SSH/SSM Access (Optional):** Direct SSH access is not required for deployment, but if needed for debugging, you can use AWS Systems Manager Session Manager to connect to the instance (the IAM role includes the AmazonSSMManagedInstanceCore policy). Alternatively, you may specify an EC2 key pair name in the Terraform variables to allow SSH. If using SSH, ensure port 22 is allowed in the security group (by default it is not). The recommended approach is to use Session Manager, as it doesn't require opening SSH ports.
6. **Cleanup:** To avoid charges, destroy the infrastructure when done:
   ```bash
   terraform destroy -auto-approve
   ```

## Notes
- The Nitro enclave is built and run at instance launch via cloud-init user data. The `scripts/build_enclave.sh` and `scripts/run_enclave.sh` (mirrored in the user data) contain the commands for building the enclave image (using Docker and nitro-cli) and running the enclave. The Node.js app uses a very minimal environment (Alpine Linux in the enclave) to keep the EIF small. Nitro Enclaves have no persistent storage, so everything runs in-memory.
- **Attestation & KMS:** The provided KMS key and IAM permissions are set up to illustrate how one might integrate AWS KMS with enclaves for attestation. In practice, you'd use the Nitro Enclaves SDK inside the enclave to generate an attestation document and call KMS. The KMS key policy would include condition keys (e.g., `kms:RecipientAttestation:ImageSha384`) to ensure that only a specific enclave image (or signer) can use the key.
- **Enclave Lifecycle:** The enclave will remain running as long as the instance is running. If the instance is rebooted or stopped, the enclave will terminate (since it's not persisted). You would need to rerun the enclave startup (using the provided scripts or reboot scripts) to launch it again. The Terraform user data runs only on first creation. For simplicity, this setup does not include automated redeployment of the enclave on reboot.
