#!/bin/bash
# shellcheck shell=dash

setup_ssh() {
  local ssh_key="$1"

  if [ -z "$ssh_key" ]; then
    echo "⚠️ No SSH public key provided, skipping SSH setup"
    return
  fi

  echo "👩‍💻 Setting up SSH"

  ssh-keygen -A

  echo "SSH configuration"

  sed -i '/^AllowTcpForwarding/d' /etc/ssh/sshd_config
  sed -i 's/^#Port 22/Port 2222/' /etc/ssh/sshd_config
  {
      echo "AllowTcpForwarding yes"
      echo "PermitUserEnvironment yes"
      echo "ClientAliveInterval 15m"
  } >> /etc/ssh/sshd_config

  # Have ssh logins get the same env vars we have right now (which were set in various docker layers).
  mkdir -p /root/.ssh/
  chmod 700 /root/.ssh/
  env > /root/.ssh/environment

  mkdir /var/run/sshd
  chmod 0755 /var/run/sshd

  echo "-> Adding SSH public key ($ssh_key) to authorized_keys"
  echo $ssh_key | tee -a /root/.ssh/authorized_keys

  echo "-> Starting openssh"
  /usr/sbin/sshd -f /etc/ssh/sshd_config -e -D &
}
