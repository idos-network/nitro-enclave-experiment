FROM ubuntu:latest

RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
    curl \
    ca-certificates \
    iproute2 \
    net-tools \
    iptables \
    openssh-server \
    socat \
    libnbd-bin \
    nbd-client \
    cryptsetup \
    vim \
    jq \
&& update-ca-certificates && rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Install AWS CLI v2
RUN apt-get update && apt-get install -y \
    unzip less groff \
    && rm -rf /var/lib/apt/lists/* \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip" \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip

# Install Caddy
RUN apt-get update && apt-get install -y \
    debian-keyring debian-archive-keyring apt-transport-https gnupg \
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

RUN npm install -g pm2

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy source files & scripts
COPY . .
COPY scripts/shared ./scripts/
COPY scripts/ecosystem.config.cjs .

# S3 buckets contains configurations and aws keys arn
# ARG S3_SECRETS_BUCKET
# RUN if [ -z "$S3_SECRETS_BUCKET" ]; then (echo "S3_SECRETS_BUCKET must be provided as a --build-arg"; exit 1); fi
RUN echo "INSERT_S3_BUCKET_HERE" > ./s3_secrets_bucket.txt

# Expose port (default 8000, configurable via PORT env var)
EXPOSE 8000

# Run the application
CMD ["/bin/bash", "/app/scripts/run.ash"]
