# Outputs to display useful information after deployment
output "ec2_public_ip" {
  description = "Public IP of the Nitro Enclave EC2 instance"
  value       = aws_instance.enclave_instance.public_ip
}

output "dns_name_servers" {
  description = "DNS name servers of the apex Route 53 hosted zone"
  value       = aws_route53_zone.apex.name_servers
}
