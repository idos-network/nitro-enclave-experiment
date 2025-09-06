const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8080;

app.get('/ping', (req, res) => {
  const timestamp = new Date().toISOString();

  const logEntry = `[${timestamp}] Ping endpoint accessed\n`;
  const logDir = "/home/test/logs";
  const logFile = path.join(logDir, `ping-${new Date().toISOString()}.log`);
  fs.appendFileSync(logFile, logEntry);
  
  res.json({ message: 'Pong!', timestamp });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
