# ---------- Build stage ----------
FROM ubuntu:latest AS builder

ARG FACETEC_SDK_VERSION
RUN if [ -z "$FACETEC_SDK_VERSION" ]; then (echo "FACETEC_SDK_VERSION must be provided as a --build-arg"; exit 1); fi

ARG FACETEC_CUSTOM_SERVER_DIRECTORY=./facetec-sdk/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION
ARG FACETEC_SERVER_CORE_DIRECTORY=./facetec-sdk/FaceTec-Server-Webservice/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION

# Install build dependencies (Java + Maven + Node.js + libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jdk \
    libgomp1 \
    maven \
    libavcodec-dev libavutil-dev \
    && rm -rf /var/lib/apt/lists/*

    
# Copy FaceTec Server Core and Webservice into the image.
COPY $FACETEC_SERVER_CORE_DIRECTORY /home/FaceTec_Server_Core

# Install FaceTec Server Core into Maven
RUN mvn install:install-file -Dfile=/home/FaceTec_Server_Core/libs/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION.jar -DgroupId=com.facetec.servercore -DartifactId=server -Dversion=$FACETEC_SDK_VERSION -Dpackaging=jar

# Copy FaceTec Custom Server into the image.
COPY $FACETEC_CUSTOM_SERVER_DIRECTORY/deploy /home/FaceTec_Custom_Server/deploy
COPY $FACETEC_CUSTOM_SERVER_DIRECTORY/src /home/FaceTec_Custom_Server/src
COPY $FACETEC_CUSTOM_SERVER_DIRECTORY/pom.xml /home/FaceTec_Custom_Server/pom.xml
COPY $FACETEC_CUSTOM_SERVER_DIRECTORY/config.yaml /home/FaceTec_Custom_Server/deploy/config.yaml

# FaceTec mongo storage modifications (don't store face images, just empty strings)
RUN sed -i 's#faceScanRequest.auditTrailImage.getBase64()#""#' /home/FaceTec_Custom_Server/src/main/java/com/facetec/facetecserver/database/MongoDatabase.java
RUN sed -i 's#faceScanRequest.lowQualityAuditTrailImage.getBase64()#""#' /home/FaceTec_Custom_Server/src/main/java/com/facetec/facetecserver/database/MongoDatabase.java

WORKDIR /home/FaceTec_Custom_Server/deploy
RUN mvn -f /home/FaceTec_Custom_Server/pom.xml clean package -Plinux

# ---------- Final stage ----------
FROM ubuntu:latest

ARG FACETEC_SDK_VERSION
RUN if [ -z "$FACETEC_SDK_VERSION" ]; then (echo "FACETEC_SDK_VERSION must be provided as a --build-arg"; exit 1); fi

ARG FACETEC_CUSTOM_SERVER_DIRECTORY=./facetec-sdk/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION
ARG FACETEC_SERVER_CORE_DIRECTORY=./facetec-sdk/FaceTec-Server-Webservice/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION
ARG FACETEC_USAGE_LOGS_DIRECTORY=./facetec-sdk/FaceTec-Usage-Log-Server

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    curl \
    default-jdk \
    iproute2 \
    libgomp1 \
    net-tools \
    iptables \
    openssh-server \
    socat \
    libnbd-bin \
    nbd-client \
    cryptsetup \
&& rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Install AWS CLI v2
RUN apt-get update && apt-get install -y \
    curl unzip less groff \
    && rm -rf /var/lib/apt/lists/* \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip" \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip

# Install Caddy
RUN apt-get update && apt-get install -y \
    debian-keyring debian-archive-keyring apt-transport-https curl gnupg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list \
    && chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && chmod o+r /etc/apt/sources.list.d/caddy-stable.list \ 
    && apt-get update \
    && apt-get install -y caddy \
    && rm -rf /var/lib/apt/lists/*

# Install nodejs 24.x
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && NODE_MAJOR=24 \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list

RUN apt-get update && apt-get install -y nodejs && apt-get clean && rm -rf /var/lib/apt/lists/*

# Destination directories
ENV HOME_FACETEC_CUSTOM_SERVER=/home/FaceTec_Custom_Server
ENV HOME_FACETEC_SERVER_CORE=/home/FaceTec_Server_Core
ENV HOME_FACETEC_USAGE_LOGS=/home/FaceTec_Usage_Logs_Server
ENV HOME_FACESIGN_SERVICE=/home/FaceSign_Service

# Setup & build FaceTec Server Core
COPY $FACETEC_CUSTOM_SERVER_DIRECTORY/URCTemplates /home/URCTemplates
COPY $FACETEC_CUSTOM_SERVER_DIRECTORY/OCRTemplates /home/OCRTemplates

COPY --from=builder /home/FaceTec_Custom_Server $HOME_FACETEC_CUSTOM_SERVER
# Don't copy server core, it will be fetched from S3 at runtime

WORKDIR $HOME_FACETEC_CUSTOM_SERVER/deploy/
RUN sed -i 's#serverPort: 8080#serverPort: 5000#' ./config.yaml
RUN sed -i 's#enableSearch: false#enableSearch: true#' ./config.yaml
RUN sed -i 's#search3D3DDatabaseRootDirectory: .*#search3D3DDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-3d-database#' ./config.yaml
RUN sed -i 's#search3D3DDatabaseExportRootDirectory: .*#search3D3DDatabaseExportRootDirectory: /mnt/encrypted/facetec/search-3d-3d-database-export#' ./config.yaml
RUN sed -i 's#search3D3DAccessibilityDatabaseRootDirectory: .*#search3D3DAccessibilityDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-3d-accessibility#' ./config.yaml
RUN sed -i 's#search3D2DFacePortraitDatabaseRootDirectory: .*#search3D2DFacePortraitDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-2d-face-portrait#' ./config.yaml
RUN sed -i 's#search3D2DKioskPOSDatabaseRootDirectory: .*#search3D2DKioskPOSDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-2d-kiosk#' ./config.yaml
RUN sed -i 's#search2D2DIDScanPhotoDatabaseRootDirectory: .*#search2D2DIDScanPhotoDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-id-scan#' ./config.yaml
RUN sed -i 's#search2D2DProfilePicDatabaseRootDirectory: .*#search2D2DProfilePicDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-profile-pic#' ./config.yaml
RUN sed -i 's#search2D2DFacePortraitDatabaseRootDirectory: .*#search2D2DFacePortraitDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-face-portrait#' ./config.yaml
RUN sed -i 's#usageLogServerUri: .*#usageLogServerUri: http://localhost:3000/#' ./config.yaml
RUN printf "#!/bin/bash\njava -cp $HOME_FACETEC_SERVER_CORE/libs/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION.jar:FaceTec-Server-Webservice.jar com.facetec.facetecserver.app.App" > ./run.ash

# Setup FaceTec Usage Logs Server
WORKDIR $HOME_FACETEC_USAGE_LOGS
COPY $FACETEC_USAGE_LOGS_DIRECTORY/package.json ./package.json
RUN npm install
COPY $FACETEC_USAGE_LOGS_DIRECTORY/ .
RUN sed -i 's/54.70.182.147/logs.facetec.com/' ./utils/logUploader.js
RUN sed -i 's#usageLogsDirectory: ""#usageLogsDirectory: "/mnt/encrypted/usage-logs"#' ./config.yml

# Setup FaceSign Service
WORKDIR $HOME_FACESIGN_SERVICE
COPY ./facesign-service/ .
RUN npm install

# Download or copy all required secrets and setup environment
WORKDIR /home/deploy

ARG AWS_KMS_SECRETS_KEY_ID
RUN if [ -z "$AWS_KMS_SECRETS_KEY_ID" ]; then (echo "AWS_KMS_SECRETS_KEY_ID must be provided as a --build-arg"; exit 1); fi
RUN echo $AWS_KMS_SECRETS_KEY_ID > ./secrets_key.arn

ARG AWS_KMS_SECRETS_FACETEC_KEY_ID
RUN if [ -z "$AWS_KMS_SECRETS_FACETEC_KEY_ID" ]; then (echo "AWS_KMS_SECRETS_FACETEC_KEY_ID must be provided as a --build-arg"; exit 1); fi
RUN echo $AWS_KMS_SECRETS_FACETEC_KEY_ID > ./secrets_facetec_key.arn

ARG AWS_KMS_JWT_KEY_ID
RUN if [ -z "$AWS_KMS_JWT_KEY_ID" ]; then (echo "AWS_KMS_JWT_KEY_ID must be provided as a --build-arg"; exit 1); fi
RUN echo $AWS_KMS_JWT_KEY_ID > ./jwt_key.arn

# Setup PM2
RUN npm install -g pm2
COPY ./facesign-service/scripts/ecosystem.config.js ./ecosystem.config.js

# Support boot.ash scripts
COPY ./facesign-service/authorized_keys /root/.ssh/authorized_keys
COPY ./facesign-service/scripts/run.ash ./
COPY ./facesign-service/scripts/boot.ash ./

# Setup /etc/hosts entries for local services
ARG MONGO_HOST
RUN if [ -z "$MONGO_HOST" ]; then (echo "MONGO_HOST must be provided as a --build-arg"; exit 1); fi

RUN echo "127.0.0.1 $MONGO_HOST" | tee -a /root/extra_hosts
RUN echo "127.0.0.1 $(echo "$MONGO_HOST" | sed 's#-cluster.cluster-#-cluster.#')" | tee -a /root/extra_hosts
RUN echo "127.0.0.1 logs.facetec.com" | tee -a /root/extra_hosts

# AWS kms (AWS identity are on ip tables forwarded to 127.0.0.2!)
RUN echo "127.0.0.3 kms.eu-west-1.amazonaws.com" | tee -a /root/extra_hosts

ARG S3_SECRETS_BUCKET
RUN if [ -z "$S3_SECRETS_BUCKET" ]; then (echo "S3_SECRETS_BUCKET must be provided as a --build-arg"; exit 1); fi
RUN echo $S3_SECRETS_BUCKET > ./s3_secrets_bucket.txt

# AWS secrets S3
RUN echo "127.0.0.4 $S3_SECRETS_BUCKET.s3.eu-west-1.amazonaws.com" | tee -a /root/extra_hosts
RUN echo "127.0.0.5 $S3_SECRETS_BUCKET.s3-eu-west-1.amazonaws.com" | tee -a /root/extra_hosts

# Let's encrypt acme lookup
RUN echo "127.0.0.6 acme-v02.api.letsencrypt.org" | tee -a /root/extra_hosts

EXPOSE 8080

CMD ["/bin/bash", "/home/deploy/boot.ash"]
