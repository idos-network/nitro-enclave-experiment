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
