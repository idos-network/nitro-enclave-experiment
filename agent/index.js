import net from "net";
import { sendOsMetrics, sendPm2Metrics } from "./metrics.js";
import { sendLog } from "./logs.js";

const server = net.createServer((socket) => {
  console.log("client connected");
  let acc = "";
  socket.on("data", chunk => {
    acc += chunk.toString();
    let idx;
    while ((idx = acc.indexOf("\n")) >= 0) {
      const line = acc.slice(0, idx).trim();
      acc = acc.slice(idx + 1);
      if (line) {
        const obj = JSON.parse(line);
        if (obj.type === "os") {
          sendOsMetrics(obj).catch(err => console.error("Failed to send OS metrics", err));
        } else if (obj.type === "pm2") {
          sendPm2Metrics(obj).catch(err => console.error("Failed to send PM2 metrics", err));
        } else {
          sendLog(obj).catch(err => console.error("Failed to send log", err));
        }
      }
    }
  });
  socket.on("end", () => console.log("client disconnected"));
  socket.on("error", (e) => console.error("socket error", e));
});

(async () => {
  const PORT = Number(process.env.PORT) || 7000;
  server.listen(PORT, "127.0.0.1", () => console.log(`Listening on ${PORT}`));
})();
