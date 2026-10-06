# Copy Vector from a pinned image.
FROM timberio/vector@sha256:32fd554fdd6dc3c17b5ec8e983e9889f37b0c87fa3c8cc28aa318d69cf34d392 AS vector

# ---------- Build stage ----------
FROM debian:trixie-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

ARG FACETEC_SDK_VERSION
ARG FACETEC_SDK_BUCKET
ARG FACETEC_SDK_REGION
ENV FACETEC_SDK_VERSION=$FACETEC_SDK_VERSION FACETEC_SDK_BUCKET=$FACETEC_SDK_BUCKET FACETEC_SDK_REGION=$FACETEC_SDK_REGION

ARG FACETEC_S3_CORE=s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION
ARG FACETEC_S3_CUSTOM=s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION
ARG FACETEC_S3_USAGE_LOGS=s3://$FACETEC_SDK_BUCKET/FaceTec-Usage-Log-Server

# Install build dependencies (Java + Maven + Node.js + libs)
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    curl \
    default-jdk \
    libgomp1 \
    libavcodec-dev \
    libavutil-dev \
    maven \
    patch \
    && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Download aws sdk to fetch FaceTec SDK from S3. AWS CLI v2 (pinned + SHA-256 verified)
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

# Copy FaceTec Server Core and Webservice into the image.
RUN aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION/libs /home/FaceTec_Server_Core/libs

# Install FaceTec Server Core into Maven
RUN mvn install:install-file -Dfile=/home/FaceTec_Server_Core/libs/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION.jar -DgroupId=com.facetec.servercore -DartifactId=server -Dversion=$FACETEC_SDK_VERSION -Dpackaging=jar

# Copy FaceTec Custom Server into the image.
RUN aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/deploy /home/FaceTec_Custom_Server/deploy
RUN aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/src /home/FaceTec_Custom_Server/src
RUN aws s3 cp s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/pom.xml /home/FaceTec_Custom_Server/pom.xml
RUN aws s3 cp s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/config.yaml /home/FaceTec_Custom_Server/deploy/config.yaml

# Patch FaceTec server for field level encryption support
COPY ./scripts/main.patch /tmp/main.patch
WORKDIR /home/FaceTec_Custom_Server
RUN patch -p1 < /tmp/main.patch

WORKDIR /home/FaceTec_Custom_Server/deploy
RUN mvn -f /home/FaceTec_Custom_Server/pom.xml clean package -Plinux

# ---------- Final stage ----------
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

ARG FACETEC_SDK_VERSION
ARG FACETEC_SDK_BUCKET
ARG FACETEC_SDK_REGION
ENV FACETEC_SDK_VERSION=$FACETEC_SDK_VERSION FACETEC_SDK_BUCKET=$FACETEC_SDK_BUCKET FACETEC_SDK_REGION=$FACETEC_SDK_REGION

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    ca-certificates \
    cryptsetup \
    e2fsprogs \
    curl \
    default-jdk \
    iproute2 \
    iptables \
    jq \
    libgomp1 \
    libnbd-bin \
    nbd-client \
    net-tools \
    openssh-server \
    s6 \
    socat \
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

# Install libmongocrypt0 1.17.x for FLE (according to readme.md)
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    gnupg \
    && curl -s --location https://pgp.mongodb.com/libmongocrypt.asc \
      | gpg --dearmor \
      > /etc/apt/trusted.gpg.d/libmongocrypt.gpg \
    && echo "deb https://libmongocrypt.s3.amazonaws.com/apt/ubuntu jammy/libmongocrypt/1.17 universe" \
      > /etc/apt/sources.list.d/libmongocrypt.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends --no-install-suggests libmongocrypt-dev \
    && apt-get purge -y --auto-remove gnupg \
    && apt-get clean \
    && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Destination directories
ENV HOME_FACETEC_CUSTOM_SERVER=/home/FaceTec_Custom_Server
ENV HOME_FACETEC_SERVER_CORE=/home/FaceTec_Server_Core
ENV HOME_FACETEC_USAGE_LOGS=/home/FaceTec_Usage_Logs_Server
ENV HOME_FACESIGN_SERVICE=/home/FaceSign_Service

# Don't copy server core, ocr or urc templates they will be fetched from S3 at runtime
COPY --from=builder /home/FaceTec_Custom_Server $HOME_FACETEC_CUSTOM_SERVER

# Remove sources, we don't need them in final image
RUN rm -rf $HOME_FACETEC_CUSTOM_SERVER/src

WORKDIR $HOME_FACETEC_CUSTOM_SERVER/deploy/
RUN sed -i 's#database: .*#database: mongodb#' ./config.yaml
RUN sed -i 's#serverPort: 8080#serverPort: 5000#' ./config.yaml
RUN sed -i 's#enableSearch: false#enableSearch: true#' ./config.yaml
RUN sed -i 's#search3D3DDatabaseRootDirectory: .*#search3D3DDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-3d-database#' ./config.yaml
RUN sed -i 's#search3D3DAccessibilityDatabaseRootDirectory: .*#search3D3DAccessibilityDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-3d-accessibility#' ./config.yaml
RUN sed -i 's#search3D2DFacePortraitDatabaseRootDirectory: .*#search3D2DFacePortraitDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-2d-face-portrait#' ./config.yaml
RUN sed -i 's#search3D2DKioskPOSDatabaseRootDirectory: .*#search3D2DKioskPOSDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-2d-kiosk#' ./config.yaml
RUN sed -i 's#search2D2DIDScanPhotoDatabaseRootDirectory: .*#search2D2DIDScanPhotoDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-id-scan#' ./config.yaml
RUN sed -i 's#search2D2DProfilePicDatabaseRootDirectory: .*#search2D2DProfilePicDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-profile-pic#' ./config.yaml
RUN sed -i 's#search2D2DFacePortraitDatabaseRootDirectory: .*#search2D2DFacePortraitDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-face-portrait#' ./config.yaml
RUN sed -i 's#usageLogServerUri: .*#usageLogServerUri: http://localhost:3000#' ./config.yaml
RUN printf "#!/bin/bash\nexec java -cp $HOME_FACETEC_SERVER_CORE/libs/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION.jar:FaceTec-Server-Webservice.jar com.facetec.facetecserver.app.App" > ./run.ash

RUN echo "" >> ./config.yaml

# Add max simultaneous requests
RUN echo "maxSimultaneousRequests: 50" >> ./config.yaml

# Add feature flags for max 5 attempts
RUN echo "featureFlags:" >> ./config.yaml
RUN echo "  ac_lpmft: 5a0b17ec-5121-44c4-b902-3fa24ed6156d" >> ./config.yaml

# This is in config.yaml but it's not loaded
RUN sed -i 's#search3D3DDatabaseExportRootDirectory: .*#search3D3DDatabaseExportRootDirectory: /mnt/encrypted/facetec/search-3d-3d-database-export#' ./config.yaml

# This is missing in config.yaml, but server tries to load that
RUN echo "" >> ./config.yaml
RUN echo "searchDatabaseExportRootDirectory: /mnt/encrypted/facetec/search-3d-3d-database-export" >> ./config.yaml

# Setup FaceTec Usage Logs Server
WORKDIR $HOME_FACETEC_USAGE_LOGS
RUN aws s3 cp s3://$FACETEC_SDK_BUCKET/FaceTec-Usage-Log-Server/package.json ./package.json
RUN npm install
RUN aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Usage-Log-Server/ ./
RUN sed -i 's#usageLogsDirectory: ""#usageLogsDirectory: "/mnt/encrypted/usage-logs"#' ./config.yml

# Setup FaceSign Service
WORKDIR $HOME_FACESIGN_SERVICE
COPY . .
RUN pnpm install --prod --frozen-lockfile

# Download or copy all required secrets and setup environment
WORKDIR /home/deploy

# DocumentDB's TLS cert is signed by the Amazon RDS CA, not a public one.
# MONGO_URI points at it with tlsCAFile=/etc/ssl/rds-global-bundle.pem. Java
# ignores tlsCAFile, so the certs also go to the system store, which the
# ca-certificates-java hook mirrors into the JVM cacerts (one cert per file).
ARG RDS_CA_BUNDLE_SHA256=fe45bbebf92ad3e27a583bbb2ddd1553c521ed4d49af5514dc0a40372ea5395c
RUN curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" -o /etc/ssl/rds-global-bundle.pem \
    && echo "${RDS_CA_BUNDLE_SHA256}  /etc/ssl/rds-global-bundle.pem" | sha256sum -c - \
    && awk '/BEGIN CERTIFICATE/{n++} {print > ("/usr/local/share/ca-certificates/rds-" n ".crt")}' /etc/ssl/rds-global-bundle.pem \
    && update-ca-certificates
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

# Support boot.ash scripts
COPY ./scripts/run.ash ./
COPY ./scripts/shared ./shared/

# Copy vector binary & config
COPY --from=vector /usr/local/bin/vector /usr/bin/vector
COPY ./scripts/vector.yaml /etc/vector/vector.yaml

# S3 buckets contains configurations and aws keys arn
# Passed via --build-arg from scripts/enclave-build.ash
ARG S3_SECRETS_BUCKET
ARG S3_SECRETS_REGION
ENV S3_SECRETS_BUCKET=$S3_SECRETS_BUCKET S3_SECRETS_REGION=$S3_SECRETS_REGION

EXPOSE 8080
CMD ["/bin/bash", "/home/deploy/run.ash"]
