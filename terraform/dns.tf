resource "aws_route53_zone" "apex" {
  name = "nitro.idos.network"
  // TODO(pkoch): how are we going to manage zone delegation from idos.network? :x
}

resource "aws_route53_record" "apex" {
  zone_id = aws_route53_zone.apex.zone_id
  name    = aws_route53_zone.apex.name
  type    = "A"
  ttl     = 300
  records = [aws_instance.enclave_instance.public_ip]
}

resource "aws_acm_certificate" "apex" {
  domain_name       = aws_route53_record.apex.fqdn
  validation_method = "DNS"
}

resource "aws_route53_record" "apex_cert_validation" {
  name    = aws_acm_certificate.apex.domain_validation_options.resource_record_name
  type    = aws_acm_certificate.apex.domain_validation_options.resource_record_type
  zone_id = data.aws_route53_zone.apex.id
  records = [aws_acm_certificate.apex.domain_validation_options.resource_record_value]
}

resource "aws_acm_certificate_validation" "apex" {
  certificate_arn         = aws_acm_certificate.apex.arn
  validation_record_fqdns = [aws_route53_record.apex_cert_validation.fqdn]
}
