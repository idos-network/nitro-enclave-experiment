# Dockerfile for Nitro Enclave image
# Start from a lightweight Alpine Linux base
FROM alpine:3.17

# Install Node.js runtime and socat (for vsock communication)
RUN apk add --no-cache nodejs npm socat

# Set working directory inside container image
WORKDIR /app

# Copy the Node.js app and start script into the image
COPY app.js .
COPY start.sh .
RUN chmod +x start.sh

# Define the command to run when the enclave starts
CMD ["./start.sh"]
