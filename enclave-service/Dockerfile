# Copy Vector from a pinned image. The alpine variant is a static musl build.
FROM timberio/vector:0.56.0-alpine@sha256:8f2de273559680c4a6a03bb2bcf4a7636b08e0fb15269f546adc7b2cef2b6e8c AS vector

# NSM addon of @idos/nitro-nsm (packages/nitro-nsm/src/lib.rs): the attestation document from
# /dev/nsm, for KMS Decrypt with a Recipient (shared/aws.ash) and GET /attestation.
# Crates are pinned with checksums by Cargo.lock. Built on musl like the runtime image; a
# cdylib needs the C runtime linked dynamically (-crt-static) for Node to dlopen it.
FROM rust:1.92-alpine3.23@sha256:f6c22e0a256c05d44fca23bf530120b5d4a6249a393734884281ca80782329bc AS nsm

RUN apk add --no-cache musl-dev
WORKDIR /build
COPY packages/nitro-nsm/Cargo.toml packages/nitro-nsm/Cargo.lock ./
COPY packages/nitro-nsm/src ./src
RUN RUSTFLAGS="-C target-feature=-crt-static" cargo build --release --locked

# Base runtime image: Node.js at .node-version (v24.13.0) on Alpine.
FROM node:24.13.0-alpine3.23@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e

RUN apk add --no-cache \
    bash \
    blkid \
    ca-certificates \
    chrony \
    cryptsetup \
    curl \
    e2fsprogs \
    iproute2 \
    iptables \
    iptables-legacy \
    jq \
    nbd-client \
    openssh-keygen \
    openssh-server \
    openssl \
    s6 \
    socat \
    && update-ca-certificates

# Install Caddy (pinned + SHA-256 verified)
ARG CADDY_VERSION=2.11.4
ARG CADDY_SHA256=527fbf917c39189a1e3b31d34fa955601680b2d5c8055d2a87b8b9588dec7bb9
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" -o "/tmp/caddy.tar.gz" \
    && echo "${CADDY_SHA256}  /tmp/caddy.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/caddy.tar.gz -C /usr/bin caddy \
    && rm -f /tmp/caddy.tar.gz

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Build context is the repo root. /app is the pnpm workspace root and the service lives in
# /app/enclave-service, so node_modules/@idos/tee-common links to /app/packages/tee-common:
# Node only strips types from .ts files outside node_modules.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY --from=nsm /build/target/release/libnitro_nsm.so ./packages/nitro-nsm/nitro-nsm.node
COPY enclave-service ./enclave-service

# Install dependencies
# copy, not hardlink: nitro-cli's linuxkit turns tar hardlinks into symlinks, so a .js that
# pnpm deduplicated with an identical .d.ts can end up as a symlink to the .d.ts and Node refuses it
# The lockfile covers every service; drop it so another service's bump doesn't change this image
RUN pnpm install --prod --frozen-lockfile --filter "enclave-service..." --package-import-method=copy \
    && rm -rf "$(pnpm store path)" pnpm-lock.yaml

# Shared boot scripts sourced by scripts/run.ash
COPY shared ./enclave-service/scripts/shared

# DocumentDB's TLS cert is signed by the Amazon RDS CA, not a public one.
# MONGO_URI points at it with tlsCAFile=/etc/ssl/rds-global-bundle.pem
ARG RDS_CA_BUNDLE_SHA256=90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b
RUN curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" -o /etc/ssl/rds-global-bundle.pem \
    && echo "${RDS_CA_BUNDLE_SHA256}  /etc/ssl/rds-global-bundle.pem" | sha256sum -c -
# Node ignores the system store; trust the bundle even if MONGO_URI lacks tlsCAFile
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem

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
COPY enclave-service/scripts/vector.yaml /etc/vector/vector.yaml

# S3 buckets contains configurations and aws keys arn
# Passed via --build-arg from scripts/enclave-build.ash
ARG S3_SECRETS_BUCKET
ARG S3_SECRETS_REGION
ENV S3_SECRETS_BUCKET=$S3_SECRETS_BUCKET S3_SECRETS_REGION=$S3_SECRETS_REGION

# Expose port (default 8000, configurable via PORT env var)
EXPOSE 8000

# Run the application
CMD ["/bin/bash", "/app/enclave-service/scripts/run.ash"]