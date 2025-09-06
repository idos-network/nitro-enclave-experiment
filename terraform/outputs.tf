# Outputs to display useful information after deployment
output "ec2_public_ip" {
  description = "Public IP of the Nitro Enclave EC2 instance"
  value       = aws_instance.enclave_instance.public_ip
}

output "ec2_test_public_ip" {
  description = "Public IP of the Nitro Enclave Test EC2 instance"
  value       = aws_instance.enclave_instance_test.public_ip
}

output "kms_key_id" {
  description = "KMS Key ID for Nitro Enclave (for attestation purposes)"
  value       = aws_kms_key.enclave_key.id
}

output "enclave_iam_role" {
  description = "IAM role name attached to the EC2 instance"
  value       = aws_iam_role.enclave_instance_role.name
}
