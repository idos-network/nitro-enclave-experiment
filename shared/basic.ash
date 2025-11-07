#!/bin/bash
# shellcheck shell=dash

set -ueo pipefail
set -u
set -e

# Configure minimal networking
configure_basic_networking() {
  echo "⚙️ Configuring basic networking and S3 access for $1"
  ifconfig lo 127.0.0.1
  ip route add default dev lo src 127.0.0.1

  # Enable IP forwarding
  sysctl -w net.ipv4.ip_forward=1

  # AWS metadata and s3 networking
  local S3_SECRETS_BUCKET=$1

  # Aws metadata and s3 networking
  echo "-> Enabling AWS metadata endpoint"
  iptables-legacy -t nat -A OUTPUT -d 169.254.169.254 -p tcp --dport 80 -j DNAT --to-destination 127.0.0.2:80

  echo "-> Opening VSOCKs and hosts for S3 $S3_SECRETS_BUCKET"
  socat TCP4-LISTEN:80,fork,bind=127.0.0.2 VSOCK-CONNECT:3:6000 &
  socat TCP4-LISTEN:443,fork,bind=127.0.0.3 VSOCK-CONNECT:3:6001 &
  socat TCP4-LISTEN:443,fork,bind=127.0.0.4 VSOCK-CONNECT:3:6002 &
  echo "127.0.0.3 $S3_SECRETS_BUCKET.s3.eu-west-1.amazonaws.com" >> /etc/hosts
  echo "127.0.0.4 $S3_SECRETS_BUCKET.s3-eu-west-1.amazonaws.com" >> /etc/hosts
}
