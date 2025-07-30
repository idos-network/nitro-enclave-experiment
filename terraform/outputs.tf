# Outputs to display useful information after deployment
output "ec2_public_ip" {
  description = "Public IP of the Nitro Enclave EC2 instance"
  value       = aws_instance.enclave_instance.public_ip
}

output "kms_key_id" {
  description = "KMS Key ID for Nitro Enclave (for attestation purposes)"
  value       = aws_kms_key.enclave_key.id
}

output "enclave_iam_role" {
  description = "IAM role name attached to the EC2 instance"
  value       = aws_iam_role.enclave_instance_role.name
}

# DocumentDB outputs
output "docdb_endpoint" {
  description = "Endpoint of the DocumentDB cluster"
  value       = aws_docdb_cluster.docdb.endpoint
}

output "docdb_port" {
  description = "Port of the DocumentDB cluster"
  value       = aws_docdb_cluster.docdb.port
}

output "docdb_connection_string" {
  description = "Connection string for DocumentDB"
  value       = "mongodb://${var.docdb_username}:${var.docdb_password}@${aws_docdb_cluster.docdb.endpoint}:${aws_docdb_cluster.docdb.port}/?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"
  sensitive   = true
}
