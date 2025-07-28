// Simple Node.js HTTP server for Hello World
const http = require('http');
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Hello from Nitro Enclave!\n');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Server running on port ${port}`);
});
