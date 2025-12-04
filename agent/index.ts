import net from "node:net";
import { sendLog } from "./logs.ts";
import { sendOsMetrics, sendPm2Metrics } from "./metrics.ts";

const debugEnabled = process.env.DEBUG === "true";

const server = net.createServer((socket) => {
  console.log("[AGENT] client connected");

  if (debugEnabled) {
    console.log("-> [AGENT] enabling debug mode");
  }

  let acc = "";
  socket.on("data", (chunk) => {
    acc += chunk.toString();
    let idx: number;

    // biome-ignore lint/suspicious/noAssignInExpressions: This is by design
    while ((idx = acc.indexOf("\n")) >= 0) {
      const line = acc.slice(0, idx).trim();
      acc = acc.slice(idx + 1);
      if (line) {
        // Heartbeat
        if (line.trim() === "ping") {
          if (debugEnabled) {
            console.log("[AGENT] heartbeat ping received, sending pong");
          }
          socket.write("pong\n");
          continue;
        }

        const obj = JSON.parse(line);
        if (obj.type === "os") {
          if (debugEnabled) {
            console.log("[AGENT] Received OS metrics:", obj.data);
          }
          sendOsMetrics(obj).catch((err) =>
            console.error("[AGENT] Failed to send OS metrics", err),
          );
        } else if (obj.type === "pm2") {
          if (debugEnabled) {
            console.log("[AGENT] Received PM2 metrics:", obj.data);
          }
          sendPm2Metrics(obj).catch((err) =>
            console.error("[AGENT] Failed to send PM2 metrics", err),
          );
        } else {
          sendLog(obj).catch((err) => console.error("[AGENT] Failed to send log", err));
        }
      }
    }
  });

  socket.on("end", () => console.log("[AGENT] client disconnected"));
  socket.on("error", (e) => console.error("[AGENT] socket error", e));
});

(async () => {
  const PORT = Number(process.env.PORT) || 7000;
  server.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
})();
