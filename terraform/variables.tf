# Input variables for Terraform
variable "project_name" {
  description = "Project name prefix for resource naming"
  type        = string
  default     = "nitro-enclave-hello"
}

variable "instance_type" {
  description = "EC2 instance type for the parent instance (must support Nitro Enclaves)"
  type        = string
  default     = "m6i.8xlarge"
}

# DocumentDB variables
variable "docdb_username" {
  description = "Username for DocumentDB"
  type        = string
  default     = "root"
  sensitive   = true
}

variable "docdb_password" {
  description = "Password for DocumentDB"
  type        = string
  default     = "password"
  sensitive   = true
}

variable "docdb_instance_class" {
  description = "Instance class for DocumentDB"
  type        = string
  default     = "db.t3.medium"
}
