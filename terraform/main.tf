# Terraform configuration for AWS provider and overall setup
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region  = "eu-west-1"
  profile = "AdministratorAccess-763695378641"
}

# Fetch current account ID (used for KMS policy interpolation)
data "aws_caller_identity" "current" {}

# Include other .tf files (Terraform automatically loads all *.tf files in the directory)

terraform {
  backend "s3" {
    bucket       = "nitro-enclave-terraform-states"
    key          = "nitro-enclave.tfstate"
    region       = "eu-west-1"
    profile      = "AdministratorAccess-763695378641"
    use_lockfile = true
  }
}
