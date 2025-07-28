# Input variables for Terraform
variable "aws_region" {
  description = "AWS region to deploy the resources in"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name prefix for resource naming"
  type        = string
  default     = "nitro-enclave-hello"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR block for the public subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "instance_type" {
  description = "EC2 instance type for the parent instance (must support Nitro Enclaves)"
  type        = string
  default     = "c5.xlarge"
}

variable "ec2_key_name" {
  description = "Optional EC2 Key Pair name for SSH access (leave blank to disable SSH)"
  type        = string
  default     = ""
}

# Note: If ec2_key_name is empty, no key pair will be associated with the instance.
