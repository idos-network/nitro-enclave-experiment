# Copy Vector from a pinned image.
FROM timberio/vector@sha256:32fd554fdd6dc3c17b5ec8e983e9889f37b0c87fa3c8cc28aa318d69cf34d392 AS vector

# Base runtime image.
FROM ubuntu:24.04@sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    ca-certificates \
    cryptsetup \
    curl \
    iproute2 \
    iptables \
    jq \
    libnbd-bin \
    nbd-client \
    net-tools \
    openssh-server \
    socat \
    vim \
    && update-ca-certificates \
    && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Install AWS CLI v2 (pinned + SHA-256 verified)
ARG AWS_CLI_VERSION=2.36.20
ARG AWS_CLI_SHA256=59bdfab4035b0251a0c8de801abe01928861a89e27433bb80fc3fcf6dfe32352
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    unzip \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" -o "/tmp/awscliv2.zip" \
    && echo "${AWS_CLI_SHA256}  /tmp/awscliv2.zip" | sha256sum -c - \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip \
    && apt-get purge -y --auto-remove unzip \
    && apt-get clean \
    && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Install Caddy (pinned + SHA-256 verified)
ARG CADDY_VERSION=2.11.4
ARG CADDY_SHA256=c41708ffb4af9bc6d19f7d22a7a034804352a21ecc62e1d3dfe3d58e30b38a3e
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.deb" -o "/tmp/caddy.deb" \
    && echo "${CADDY_SHA256}  /tmp/caddy.deb" | sha256sum -c - \
    && dpkg -i /tmp/caddy.deb \
    && rm -f /tmp/caddy.deb

# Install Node.js at .node-version (v24.13.0), pinned + SHA-256 verified
ARG NODE_VERSION=24.13.0
ARG NODE_SHA256=6223aad1a81f9d1e7b682c59d12e2de233f7b4c37475cd40d1c89c42b737ffa8
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" -o "/tmp/node-v${NODE_VERSION}-linux-x64.tar.gz" \
    && echo "${NODE_SHA256}  /tmp/node-v${NODE_VERSION}-linux-x64.tar.gz" | sha256sum -c - \
    && tar -xzf "/tmp/node-v${NODE_VERSION}-linux-x64.tar.gz" -C /usr/local --strip-components=1 \
    && rm -f "/tmp/node-v${NODE_VERSION}-linux-x64.tar.gz" \
    && node -v | grep -F "v${NODE_VERSION}"

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy project files
COPY . .

# Install dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy source files & scripts
COPY scripts/shared ./scripts/

# Setup node-metrics
ARG NODE_EXPORTER_VERSION=1.11.0
ARG NODE_EXPORTER_SHA256=4f8fbd23b8380b8fb720b125fb9029de261dc5fcd68bfe81ae010c0d32f5f6c3
RUN curl -fsSL "https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz" -o "/tmp/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz" \
    && echo "${NODE_EXPORTER_SHA256}  /tmp/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz" | sha256sum -c - \
    && tar xzf /tmp/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz -C /tmp \
    && mv /tmp/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64/node_exporter /usr/local/bin/ \
    && rm -rf /tmp/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz \
    && rm -rf /tmp/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64

# Copy vector binary & config
COPY --from=vector /usr/local/bin/vector /usr/bin/vector
COPY scripts/vector.yaml /etc/vector/vector.yaml

# S3 buckets contains configurations and aws keys arn
# This will be replaced during the CI/CD process from secrets
ENV S3_SECRETS_BUCKET="INSERT_S3_SECRETS_BUCKET_HERE"

# Expose port (default 8000, configurable via PORT env var)
EXPOSE 8000

# Run the application
CMD ["/bin/bash", "/app/scripts/run.ash"]