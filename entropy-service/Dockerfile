FROM ubuntu:latest

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

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy source files & scripts
COPY . .

# SSH 
COPY authorized_keys /root/.ssh/authorized_keys

# Mongo and vsock tunnel
ARG MONGO_HOST
RUN if [ -z "$MONGO_HOST" ]; then (echo "MONGO_HOST must be provided as a --build-arg"; exit 1); fi
RUN echo "127.0.0.1 $MONGO_HOST" | tee -a /root/extra_hosts
RUN echo "127.0.0.1 $(echo "$MONGO_HOST" | sed 's#-cluster.cluster-#-cluster.#')" | tee -a /root/extra_hosts

ARG S3_SECRETS_BUCKET
RUN if [ -z "$S3_SECRETS_BUCKET" ]; then (echo "S3_SECRETS_BUCKET must be provided as a --build-arg"; exit 1); fi
RUN echo $S3_SECRETS_BUCKET > ./s3_secrets_bucket.txt

# AWS secrets S3
RUN echo "127.0.0.4 $S3_SECRETS_BUCKET.s3.eu-west-1.amazonaws.com" | tee -a /root/extra_hosts
RUN echo "127.0.0.5 $S3_SECRETS_BUCKET.s3-eu-west-1.amazonaws.com" | tee -a /root/extra_hosts

# Let's encrypt acme lookup
RUN echo "127.0.0.6 acme-v02.api.letsencrypt.org" | tee -a /root/extra_hosts

# Expose port (default 8000, configurable via PORT env var)
EXPOSE 8000

# Run the application
CMD ["/bin/bash", "/app/scripts/boot.ash"]
