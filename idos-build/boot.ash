#!/bin/ash
# shellcheck shell=dash
set -u
set -e
set -o pipefail

# Configure minimal networking
ifconfig lo 127.0.0.1
ip route add default dev lo src 127.0.0.1

sysctl -w net.ipv4.ip_forward=1
iptables-legacy -t nat -A OUTPUT -d 169.254.169.254 -p tcp --dport 80 -j DNAT --to-destination 127.0.0.2:80

# To be able to enable and control DNS resolution.
cat /root/extra_hosts >> /etc/hosts

if false; then #SSH#
    socat -d -d VSOCK-LISTEN:5005,fork TCP4-CONNECT:127.0.0.1:2222 &

    ssh-keygen -A

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

    echo "About to listen for root with these keys:"
    cat /root/.ssh/authorized_keys

    echo "Starting openssh"
    /usr/sbin/sshd -f /etc/ssh/sshd_config -e -D &
fi

exec bash /home/FaceTec_Custom_Server/deploy/run.sh