#!/bin/bash
#set -xe

yum update -y
amazon-linux-extras install -y aws-nitro-enclaves-cli
amazon-linux-extras install -y epel # TODO remove me
yum-config-manager --enable epel # TODO remove me
yum install -y aws-nitro-enclaves-cli-devel docker python3 \
    git git-lfs # TODO only for dev

usermod -a -G docker ec2-user
systemctl enable --now docker

sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
systemctl restart nitro-enclaves-allocator.service

mkdir -p /enclave

# Write Node.js application (Hello World server)
cat > /enclave/app.ash << NODEAPP
#!/bin/ash
set -u
set -e
set -o pipefail

ssh-keygen -A

sed -i '/^AllowTcpForwarding/d' /etc/ssh/sshd_config
echo "AllowTcpForwarding yes" >> /etc/ssh/sshd_config
echo "PermitUserEnvironment yes" >> /etc/ssh/sshd_config
echo "ClientAliveInterval 15m" >> /etc/ssh/sshd_config

sed -i -e 's/^root:!:/root::/' /etc/shadow

# Have ssh logins get the same env vars we have right now (which were set in various docker layers).
env > /root/.ssh/environment

echo "About to listen for root with these keys:"
cat /root/.ssh/authorized_keys
echo "Starting openssh"
exec /usr/sbin/sshd -f /etc/ssh/sshd_config -e -D
NODEAPP
chmod +x /enclave/app.ash

# Write enclave startup script
cat > /enclave/start.sh << STARTSH
#!/bin/sh
ifconfig lo 127.0.0.1
ip route add default dev lo src 127.0.0.1
socat VSOCK-LISTEN:5005,fork TCP:127.0.0.1:22 &
/enclave/app.ash
STARTSH
chmod +x /enclave/start.sh

# Write Dockerfile for enclave image
cat > /enclave/Dockerfile << DOCKERFILE
FROM alpine:latest

RUN apk add --no-cache nodejs python3 openssh socat

RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh/
COPY authorized_keys /root/.ssh/authorized_keys
RUN chmod 600 /root/.ssh/authorized_keys

WORKDIR /enclave
COPY app.ash .
COPY start.sh .
CMD ["/enclave/start.sh"]
DOCKERFILE

# Set NITRO_CLI_ARTIFACTS environment variable
echo "export NITRO_CLI_ARTIFACTS=/var/lib/nitro_enclaves" | sudo tee /etc/profile.d/nitro.sh > /dev/null
. /etc/profile.d/nitro.sh
mkdir -p $NITRO_CLI_ARTIFACTS
chmod 700 $NITRO_CLI_ARTIFACTS

sudo -u ec2-user aws s3 sync s3://idos-nitro-facetec/ ~ec2-user/custom-server/

cp ~ec2-user/.ssh/authorized_keys /enclave/authorized_keys

echo "Setup TCP to VSOCK proxy"
sudo docker run -d -p 2222:2222 --privileged alpine/socat TCP-LISTEN:2222,fork,reuseaddr VSOCK:16:5005

docker build -t curiosity:latest /enclave/ \
&& sudo nitro-cli build-enclave --docker-uri curiosity:latest --output-file $NITRO_CLI_ARTIFACTS/curiosity.eif \
; # && sudo nitro-cli run-enclave --eif-path $NITRO_CLI_ARTIFACTS/curiosity.eif --memory 2048 --cpu-count 2 --enclave-cid 16 --debug-mode --attach-console

exit 0
# Build the enclave Docker image and create an Enclave Image File (EIF)
#docker build -t curiosity:latest /enclave/ \
#&& nitro-cli build-enclave --docker-uri curiosity:latest --output-file $NITRO_CLI_ARTIFACTS/curiosity.eif \
#&& nitro-cli run-enclave --eif-path $NITRO_CLI_ARTIFACTS/curiosity.eif --memory 2048 --cpu-count 2 --enclave-cid 16 --debug-mode --attach-console
# nitro-cli run-enclave --eif-path $NITRO_CLI_ARTIFACTS/curiosity.eif --memory 2048 --cpu-count 2 --enclave-cid 16 --debug-mode --attach-console

# /enclave/tcp-to-vsock.py &
# sudo less /var/log/cloud-init-output.log
# echo "- {address: nitro-enclave-hello-docdb-cluster.cluster-cjasoqwi4beb.eu-central-1.docdb.amazonaws.com, port: 27017}" | sudo tee -a /etc/nitro_enclaves/vsock-proxy.yaml
# sudo vsock-proxy 123 nitro-enclave-hello-docdb-cluster.cluster-cjasoqwi4beb.eu-central-1.docdb.amazonaws.com 27017
# sudo vsock-proxy 123 icanhazip.com 443

# docker build -t popeye ~ec2-user/popeye
# sudo nitro-cli build-enclave --docker-uri popeye --output-file $NITRO_CLI_ARTIFACTS/popeye.eif
# sudo nitro-cli run-enclave --eif-path $NITRO_CLI_ARTIFACTS/popeye.eif --memory 26332 --cpu-count 2 --enclave-cid 16 --debug-mode --attach-console
nitro-cli console --enclave-id "$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')"
/facetec/facetec_usage_logs_server/facetec-usage-logs/usage-logs/default-instance

(
    sudo rm -rf /tmp/??????????
    sudo rm -f $NITRO_CLI_ARTIFACTS/facetec_custom_server.eif

    set -e
    docker build -t facetec_custom_server:latest ~ec2-user/custom-server/

    sudo sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
    sudo systemctl restart nitro-enclaves-allocator.service

    sudo nitro-cli build-enclave --docker-uri facetec_custom_server:latest --output-file $NITRO_CLI_ARTIFACTS/facetec_custom_server.eif

    sudo sed -i 's/^memory_mib:.*/memory_mib: 64000/' /etc/nitro_enclaves/allocator.yaml
    sudo systemctl restart nitro-enclaves-allocator.service

    sudo nitro-cli run-enclave --eif-path $NITRO_CLI_ARTIFACTS/facetec_custom_server.eif --memory 64000 --cpu-count 2 --enclave-cid 16 --debug-mode --attach-console
)
