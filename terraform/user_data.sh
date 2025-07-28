#!/bin/bash
#set -xe

yum update -y
amazon-linux-extras install -y aws-nitro-enclaves-cli
yum install -y aws-nitro-enclaves-cli-devel docker python3

systemctl enable --now docker

sed -i 's/^memory_mib:.*/memory_mib: 2048/' /etc/nitro_enclaves/allocator.yaml
systemctl restart nitro-enclaves-allocator.service

mkdir -p /enclave

cat > /enclave/tcp-to-vsock.py << FILE
#!/usr/bin/env python3
import socket
import threading

TCP_PORT = 80
VSOCK_CID = 16
VSOCK_PORT = 5005

def handle_client(client_socket):
    print(f"New thread handler for {client_socket}")
    vsock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    vsock.connect((VSOCK_CID, VSOCK_PORT))
    print(f"Connected {vsock}")
    while True:
        print(f"Waiting for data from client")
        data = client_socket.recv(512)
        if not data:
            print(f"Got {data}. Breaking.")
            break
        print(f"Got {len(data)} bytes from client. Sending data to vsock")
        vsock.sendall(data)
        print(f"Sent to vsock. Waiting for data from vsock")
        response = vsock.recv(512)
        if not response:
            print(f"Got {response}. Breaking.")
            break
        print(f"Got {len(response)} bytes from vsock. Sending data to client")
        client_socket.sendall(response)
        print(f"Data sent. Looping")
    print(f"Loop broken. Closing sockets.")
    client_socket.close()
    vsock.close()

def start_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("0.0.0.0", TCP_PORT))
    server.listen()
    print(f"Listening on TCP port {TCP_PORT} and forwarding to VSOCK {VSOCK_CID}:{VSOCK_PORT}")

    while True:
        client_socket, addrinfo = server.accept()
        print(f"Accepted from {addrinfo}")
        client_handler = threading.Thread(target=handle_client, args=(client_socket,))
        client_handler.start()

if __name__ == "__main__":
    start_server()
FILE
chmod +x /enclave/tcp-to-vsock.py

cat > /enclave/vsock-to-tcp.py << FILE
#!/usr/bin/env python3
import socket
import threading

TCP_HOST = "127.0.0.1"
TCP_PORT = 3000
VSOCK_CID = socket.VMADDR_CID_ANY
VSOCK_PORT = 5005

def handle_client(vsock_client):
    print(f"New thread handler for {vsock_client}")
    tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tcp_socket.connect((TCP_HOST, TCP_PORT))
    print(f"Connected to TCP {TCP_HOST}:{TCP_PORT}")
    while True:
        print(f"Waiting for data from vsock")
        data = vsock_client.recv(512)
        if not data:
            print(f"Got {data}. Breaking.")
            break
        print(f"Got {len(data)} bytes from vsock. Sending data to TCP")
        tcp_socket.sendall(data)
        print(f"Sent to TCP. Waiting for data from TCP")
        response = tcp_socket.recv(512)
        if not response:
            print(f"Got {response}. Breaking.")
            break
        print(f"Got {len(response)} bytes from TCP. Sending data to vsock")
        vsock_client.sendall(response)
        print(f"Data sent. Looping")
    print(f"Loop broken. Closing sockets.")
    vsock_client.close()
    tcp_socket.close()

def start_server():
    vsock_server = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    vsock_server.bind((VSOCK_CID, VSOCK_PORT))
    vsock_server.listen()
    print(f"Listening on VSOCK {VSOCK_CID}:{VSOCK_PORT} and forwarding to TCP {TCP_HOST}:{TCP_PORT}")

    while True:
        vsock_client, addrinfo = vsock_server.accept()
        print(f"Accepted from {addrinfo}")
        client_handler = threading.Thread(target=handle_client, args=(vsock_client,))
        client_handler.start()

if __name__ == "__main__":
    start_server()
FILE
chmod +x /enclave/vsock-to-tcp.py

# Write Node.js application (Hello World server)
cat > /enclave/app.js << NODEAPP
#!/usr/bin/env node
const http = require('http');
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Hello from Nitro Enclave!\n');
});
server.listen(port, '0.0.0.0', () => {
    console.log("Server running on port: " + port);
});
server.on('error', (err) => {
    console.error('Server error:', err);
});
NODEAPP
chmod +x /enclave/app.js

# Write enclave startup script
cat > /enclave/start.sh << STARTSH
#!/bin/sh
ifconfig lo 127.0.0.1
ip route add default dev lo src 127.0.0.1
/enclave/app.js &
/enclave/vsock-to-tcp.py
STARTSH
chmod +x /enclave/start.sh

# Write Dockerfile for enclave image
cat > /enclave/Dockerfile << DOCKERFILE
FROM alpine:3.17
RUN apk add --no-cache nodejs python3
WORKDIR /enclave

COPY vsock-to-tcp.py .
COPY tcp-to-vsock.py .
COPY app.js .
COPY start.sh .
CMD ["/enclave/start.sh"]
DOCKERFILE

# Set NITRO_CLI_ARTIFACTS environment variable
export NITRO_CLI_ARTIFACTS=/var/lib/nitro_enclaves
mkdir -p $NITRO_CLI_ARTIFACTS
chmod 700 $NITRO_CLI_ARTIFACTS

# Build the enclave Docker image and create an Enclave Image File (EIF)
docker build -t hello-enclave:latest /enclave
nitro-cli build-enclave --docker-uri hello-enclave:latest --output-file $NITRO_CLI_ARTIFACTS/hello.eif

nitro-cli run-enclave --eif-path $NITRO_CLI_ARTIFACTS/hello.eif --memory 2048 --cpu-count 2 --enclave-cid 16 --debug-mode
nitro-cli console --enclave-id "$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')"

/enclave/tcp-to-vsock.py &

# sudo less /var/log/cloud-init-output.log
