# Copy Vector from a pinned image.
FROM timberio/vector@sha256:32fd554fdd6dc3c17b5ec8e983e9889f37b0c87fa3c8cc28aa318d69cf34d392 AS vector

# Base runtime image.
FROM ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254

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
    && update-ca-certificates \
    && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Install AWS CLI v2
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    unzip \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip" \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip \
    && apt-get purge -y --auto-remove unzip \
    && apt-get clean \
    && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Install Caddy
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    apt-transport-https \
    debian-archive-keyring \
    debian-keyring \
    gnupg \
    && curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" -o /etc/apt/sources.list.d/caddy-stable.list \
    && chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && chmod o+r /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends --no-install-suggests caddy \
    && apt-get purge -y --auto-remove \
       apt-transport-https \
       debian-archive-keyring \
       debian-keyring \
       gnupg \
    && apt-get clean \
    && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Install nodejs 24.x
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && NODE_MAJOR=24 \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends --no-install-suggests nodejs \
    && apt-get purge -y --auto-remove \
       gnupg \
    && apt-get clean \
    && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

RUN npm install -g pm2@7.0.1

WORKDIR /app

# Copy project files
COPY . .

# Install dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy source files & scripts
COPY scripts/shared ./scripts/
COPY scripts/ecosystem.config.cjs .

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