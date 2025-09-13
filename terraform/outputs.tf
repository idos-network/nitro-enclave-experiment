# Outputs to display useful information after deployment
output "ec2_public_ip" {
  description = "Public IP of the Nitro Enclave EC2 instance"
  value       = aws_instance.enclave_instance.public_ip
}

output "ec2_test_public_ip" {
  description = "Public IP of the Nitro Enclave Test EC2 instance"
  value       = aws_instance.enclave_instance_test.public_ip
}
