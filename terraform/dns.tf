locals {
  apex = "nitro.idos.network"
}

resource "aws_route53_zone" "apex" {
  name = "${local.apex}."
  // TODO(pkoch): how are we going to manage zone delegation from idos.network? :x
}

resource "aws_route53_record" "apex" {
  zone_id = aws_route53_zone.apex.zone_id
  name    = "${local.apex}."
  type    = "A"
  ttl     = 300
  records = [aws_instance.enclave_instance.public_ip]
}

resource "aws_acm_certificate" "apex" {
  domain_name       = aws_route53_record.apex.fqdn
  validation_method = "DNS"
}

resource "aws_acm_certificate_validation" "apex" {
  certificate_arn         = aws_acm_certificate.apex.arn
  validation_record_fqdns = [aws_route53_record.apex_cert_validation.fqdn]
}

resource "aws_route53_record" "apex_cert_validation" {
  name    = tolist(aws_acm_certificate.apex.domain_validation_options)[0].resource_record_name
  type    = tolist(aws_acm_certificate.apex.domain_validation_options)[0].resource_record_type
  zone_id = aws_route53_zone.apex.id
  records = [tolist(aws_acm_certificate.apex.domain_validation_options)[0].resource_record_value]
  ttl     = 3600
}
