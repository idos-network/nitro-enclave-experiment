# ---------- Build stage ----------
FROM ubuntu:latest AS builder

ENV FACETEC_SDK_VERSION="INSERT_FACETEC_SDK_VERSION_HERE"
ENV FACETEC_SDK_BUCKET="INSERT_FACETEC_SDK_BUCKET_HERE"

ARG FACETEC_S3_CORE=s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION
ARG FACETEC_S3_CUSTOM=s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION
ARG FACETEC_S3_USAGE_LOGS=s3://$FACETEC_SDK_BUCKET/FaceTec-Usage-Log-Server

# Install build dependencies (Java + Maven + Node.js + libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jdk \
    libgomp1 \
    maven \
    libavcodec-dev libavutil-dev \
    && rm -rf /var/lib/apt/lists/*

# Download aws sdk to fetch FaceTec SDK from S3
RUN apt-get update && apt-get install -y \
    curl unzip less groff \
    && rm -rf /var/lib/apt/lists/* \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip" \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip
    
# Copy FaceTec Server Core and Webservice into the image.
RUN aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION/libs /home/FaceTec_Server_Core/libs

# Install FaceTec Server Core into Maven
RUN mvn install:install-file -Dfile=/home/FaceTec_Server_Core/libs/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION.jar -DgroupId=com.facetec.servercore -DartifactId=server -Dversion=$FACETEC_SDK_VERSION -Dpackaging=jar

# Copy FaceTec Custom Server into the image.
RUN aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/deploy /home/FaceTec_Custom_Server/deploy
RUN aws s3 sync s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/src /home/FaceTec_Custom_Server/src
RUN aws s3 cp s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/pom.xml /home/FaceTec_Custom_Server/pom.xml
RUN aws s3 cp s3://$FACETEC_SDK_BUCKET/FaceTec-Server-Webservice/FaceTec-Server-Webservice-$FACETEC_SDK_VERSION/config.yaml /home/FaceTec_Custom_Server/deploy/config.yaml

# FaceTec mongo storage modifications (don't store face images, just empty strings)
RUN sed -i 's#faceScanRequest.auditTrailImage.getBase64()#""#' /home/FaceTec_Custom_Server/src/main/java/com/facetec/facetecserver/database/MongoDatabase.java
RUN sed -i 's#faceScanRequest.lowQualityAuditTrailImage.getBase64()#""#' /home/FaceTec_Custom_Server/src/main/java/com/facetec/facetecserver/database/MongoDatabase.java

WORKDIR /home/FaceTec_Custom_Server/deploy
RUN mvn -f /home/FaceTec_Custom_Server/pom.xml clean package -Plinux

# ---------- Final stage ----------
FROM ubuntu:latest

ENV FACETEC_SDK_VERSION="INSERT_FACETEC_SDK_VERSION_HERE"
ENV FACETEC_SDK_BUCKET="INSERT_FACETEC_SDK_BUCKET_HERE"

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
    vim \
    jq \
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

# Don't copy server core, ocr or urc templates they will be fetched from S3 at runtime
COPY --from=builder /home/FaceTec_Custom_Server $HOME_FACETEC_CUSTOM_SERVER

WORKDIR $HOME_FACETEC_CUSTOM_SERVER/deploy/
RUN sed -i 's#serverPort: 8080#serverPort: 5000#' ./config.yaml
RUN sed -i 's#enableSearch: false#enableSearch: true#' ./config.yaml
RUN sed -i 's#search3D3DDatabaseRootDirectory: .*#search3D3DDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-3d-database#' ./config.yaml
RUN sed -i 's#search3D3DAccessibilityDatabaseRootDirectory: .*#search3D3DAccessibilityDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-3d-accessibility#' ./config.yaml
RUN sed -i 's#search3D2DFacePortraitDatabaseRootDirectory: .*#search3D2DFacePortraitDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-2d-face-portrait#' ./config.yaml
RUN sed -i 's#search3D2DKioskPOSDatabaseRootDirectory: .*#search3D2DKioskPOSDatabaseRootDirectory: /mnt/encrypted/facetec/search-3d-2d-kiosk#' ./config.yaml
RUN sed -i 's#search2D2DIDScanPhotoDatabaseRootDirectory: .*#search2D2DIDScanPhotoDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-id-scan#' ./config.yaml
RUN sed -i 's#search2D2DProfilePicDatabaseRootDirectory: .*#search2D2DProfilePicDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-profile-pic#' ./config.yaml
RUN sed -i 's#search2D2DFacePortraitDatabaseRootDirectory: .*#search2D2DFacePortraitDatabaseRootDirectory: /mnt/encrypted/facetec/search-2d-2d-face-portrait#' ./config.yaml
RUN sed -i 's#usageLogServerUri: .*#usageLogServerUri: http://localhost:3000/#' ./config.yaml
RUN printf "#!/bin/bash\njava -cp $HOME_FACETEC_SERVER_CORE/libs/FaceTecSDK-Server-Core-$FACETEC_SDK_VERSION.jar:FaceTec-Server-Webservice.jar com.facetec.facetecserver.app.App" > ./run.ash

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
RUN sed -i 's/54.70.182.147/logs.facetec.com/' ./utils/logUploader.js
RUN sed -i 's#usageLogsDirectory: ""#usageLogsDirectory: "/mnt/encrypted/usage-logs"#' ./config.yml

# Setup FaceSign Service
WORKDIR $HOME_FACESIGN_SERVICE
COPY ./facesign-service/ .
RUN npm install

# Download or copy all required secrets and setup environment
WORKDIR /home/deploy

# Setup PM2
RUN npm install -g pm2
COPY ./facesign-service/scripts/ecosystem.config.js ./ecosystem.config.js

# Support boot.ash scripts
COPY ./facesign-service/scripts/run.ash ./
COPY ./facesign-service/scripts/shared ./shared/

ENV S3_SECRETS_BUCKET="INSERT_S3_SECRETS_BUCKET_HERE"

EXPOSE 8080
CMD ["/bin/bash", "/home/deploy/run.ash"]
