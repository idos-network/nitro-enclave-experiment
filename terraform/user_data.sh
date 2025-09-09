#!/bin/bash
set -e

yum update -y
amazon-linux-extras install -y aws-nitro-enclaves-cli
yum install -y aws-nitro-enclaves-cli-devel docker

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

# Incoming
sudo docker run --net=host -d --restart unless-stopped --privileged --name tcp-2222-vsock-16-5005         alpine/socat -d -d TCP-LISTEN:2222,fork VSOCK-CONNECT:16:5005
sudo docker run --net=host -d --restart unless-stopped --privileged --name tcp-8080-vsock-16-5006         alpine/socat -d -d TCP-LISTEN:8080,fork VSOCK-CONNECT:16:5006

# Outgoing
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6006-tcp-mongo-27017     alpine/socat -d -d VSOCK-LISTEN:6006,fork TCP:"$MONGO_HOST":27017
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6007-tcp-logs.facetec-22 alpine/socat -d -d VSOCK-LISTEN:6007,fork TCP:logs.facetec.com:22

# AWS metadata
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6008-tcp-aws-metadata-80 alpine/socat -d -d VSOCK-LISTEN:6008,fork TCP:169.254.169.254:80

# AWS s3.eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6009-tcp-aws-s3-eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6009,fork TCP:"s3.eu-west-1.amazonaws.com":443

# AWS nitro-enclave-hello-usage-logs.s3.eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6010-tcp-aws-nitro-enclave-hello-usage-logs-s3-eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6010,fork TCP:"nitro-enclave-hello-usage-logs.s3.eu-west-1.amazonaws.com":443

# AWS nitro-enclave-hello-usage-logs.s3-eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6011-tcp-aws-nitro-enclave-hello-usage-logs-s3--eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6011,fork TCP:"nitro-enclave-hello-usage-logs.s3-eu-west-1.amazonaws.com":443

# AWS nitro-enclave-hello-3d-db.s3.eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6012-tcp-nitro-enclave-hello-3d-db-s3-eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6012,fork TCP:"nitro-enclave-hello-3d-db.s3.eu-west-1.amazonaws.com":443

# AWS nitro-enclave-hello-3d-db.s3-eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6013-tcp-aws-nitro-enclave-hello-3d-db-s3--eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6013,fork TCP:"nitro-enclave-hello-3d-db.s3-eu-west-1.amazonaws.com":443

# AWS nitro-enclave-hello-config.s3.eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6014-tcp-aws-nitro-enclave-hello-config-s3--eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6014,fork TCP:"nitro-enclave-hello-config.s3.eu-west-1.amazonaws.com":443

# AWS nitro-enclave-hello-config.s3-eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6015-tcp-aws-nitro-enclave-hello-config-s3--eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6015,fork TCP:"nitro-enclave-hello-config.s3-eu-west-1.amazonaws.com":443

# AWS kms.eu-west-1.amazonaws.com
sudo docker run --net=host -d --restart unless-stopped --privileged --name vsock-6016-tcp-aws-kms-s3--eu-west-1-443 alpine/socat -d -d VSOCK-LISTEN:6016,fork TCP:"kms.eu-west-1.amazonaws.com":443

sudo -u ec2-user mkdir -p ~ec2-user/custom-server
cp ~ec2-user/.ssh/authorized_keys ~ec2-user/custom-server/
