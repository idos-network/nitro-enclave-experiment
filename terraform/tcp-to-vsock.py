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
