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
