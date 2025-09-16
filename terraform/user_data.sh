#!/bin/bash
set -e

yum update -y
amazon-linux-extras install -y aws-nitro-enclaves-cli
yum install -y aws-nitro-enclaves-cli-devel qemu-img libvirt libvirt-devel make gcc

usermod -a -G docker ec2-user
systemctl enable --now docker

# shellcheck disable=SC1090
. <(echo "export NITRO_CLI_ARTIFACTS=/var/lib/nitro_enclaves" | sudo tee /etc/profile.d/nitro.sh)
mkdir -p "$NITRO_CLI_ARTIFACTS"
chmod 700 "$NITRO_CLI_ARTIFACTS"

MONGO_HOST="$(aws docdb describe-db-clusters --region eu-west-1 | jq -r .DBClusters[0].Endpoint)"
if [[ "${MONGO_HOST:-null}" == "null" ]]; then
    echo >&2 "Couldn't determine MONGO_HOST"
    exit 1
fi

# Incoming (ssh)
sudo docker run --net=host -d --restart unless-stopped --privileged --name tcp-2222-vsock-16-5005         alpine/socat -d -d TCP-LISTEN:2222,fork VSOCK-CONNECT:16:5005

# Incoming (app)
sudo docker run --net=host -d --restart unless-stopped --privileged --name tcp-80-vsock-16-5006          alpine/socat -d -d TCP-LISTEN:80,fork VSOCK-CONNECT:16:5006
sudo docker run --net=host -d --restart unless-stopped --privileged --name tcp-443-vsock-16-5007         alpine/socat -d -d TCP-LISTEN:443,fork VSOCK-CONNECT:16:5007

# Outgoing
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6006-tcp-mongo-27017     alpine/socat -d -d VSOCK-LISTEN:6006,fork TCP:"$MONGO_HOST":27017
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6007-tcp-logs.facetec-22 alpine/socat -d -d VSOCK-LISTEN:6007,fork TCP:logs.facetec.com:22

# AWS metadata (iptables)
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6008-tcp-aws-metadata-80 alpine/socat -d -d VSOCK-LISTEN:6008,fork TCP:169.254.169.254:80

# AWS kms.eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6009-tcp-aws-kms-s3--eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6009,fork TCP:"kms.eu-west-1.amazonaws.com":443

# AWS s3 for secrets (outgoing)
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6010-tcp-aws-nitro-enclave-hello-secrets-s3-eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6010,fork TCP:"nitro-enclave-hello-secrets.s3.eu-west-1.amazonaws.com":443
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6011-tcp-aws-nitro-enclave-hello-secrets-s3-eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6011,fork TCP:"nitro-enclave-hello-secrets.s3-eu-west-1.amazonaws.com":443

cd ~
wget https://download.libguestfs.org/nbdkit/1.44-stable/nbdkit-1.44.3.tar.gz
tar -xvf nbdkit-1.44.3.tar.gz
cd nbdkit-1.44.3
./configure --disable-python
make -j 4
make install
cd ~
rm -rf ./nbdkit-1.44.3
rm -f ./nbdkit-1.44.3.tar.gz

# Prepare systemd daemon for nbdkit
cat <<'EOF' | sudo tee /etc/systemd/system/nbdkit.service
[Unit]
Description=NBDKit vsock server
After=network.target

[Service]
ExecStart=/usr/local/sbin/nbdkit --vsock --port=10809 --foreground file /dev/sdh
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nbdkit.service
systemctl start nbdkit.service

sudo -u ec2-user mkdir -p ~ec2-user/custom-server
