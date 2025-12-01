import net from "node:net";
import os from "node:os";
import pm2 from "pm2";

function pm2Stats() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);

      pm2.list((err, list) => {
        pm2.disconnect();
        if (err) return reject(err);

        resolve(
          list.map((proc) => ({
            name: proc.name,
            pid: proc.pid,
            status: proc.pm2_env?.status,
            cpu: proc.monit?.cpu,
            memory: proc.monit?.memory,
          })),
        );
      });
    });
  });
}

class AgentClient {
  private host: string;
  private port: number;
  private client: net.Socket | null;
  private heartbeatInterval: NodeJS.Timeout | null;
  private pongCheckInterval: NodeJS.Timeout | null;
  private statsInterval: NodeJS.Timeout | null;
  private lastPong: number;
  private reconnectDelay: number;
  private maxReconnectDelay: number;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
    this.client = null;
    this.heartbeatInterval = null;
    this.pongCheckInterval = null;
    this.statsInterval = null;
    this.lastPong = Date.now();
    this.reconnectDelay = 1000; // start with 1s
    this.maxReconnectDelay = 30000; // cap at 30s
  }

  connect() {
    console.log(`[AGENT] Connecting to ${this.host}:${this.port}...`);

    this.client = net.createConnection({ host: this.host, port: this.port });

    this.client.on("connect", () => this.onConnect());
    this.client.on("data", (data) => this.onData(data));
    this.client.on("error", (err) => this.onError(err));
    this.client.on("close", () => this.onClose());
  }

  onConnect() {
    console.log("[AGENT] Connected to host via socat/vsock");
    this.lastPong = Date.now();
    this.reconnectDelay = 1000; // reset delay

    // heartbeat ping
    this.heartbeatInterval = setInterval(() => {
      this.client?.write("ping\n");
    }, 5000);

    // heartbeat check
    this.pongCheckInterval = setInterval(() => {
      if (Date.now() - this.lastPong > 15000) {
        console.error("[AGENT] No pong in 15s, destroying socket...");
        this.client?.destroy();
      }
    }, 5000);

    // send stats
    this.statsInterval = setInterval(() => {
      this.writeLog("os", {
        loadavg: os.loadavg()[0],
        memUsed: os.totalmem() - os.freemem(),
        memTotal: os.totalmem(),
      });

      pm2Stats()
        .then((stats) => {
          this.writeLog("pm2", stats);
        })
        .catch((err) => console.error("Failed to get PM2 stats", err));
    }, 15000);
  }

  // biome-ignore lint/suspicious/noExplicitAny: On data on socket
  onData(data: any) {
    const messages = data
      .toString()
      .split("\n")
      .map((s: string) => s.trim())
      .filter(Boolean);

    for (const msg of messages) {
      if (msg === "pong") {
        this.lastPong = Date.now();
      } else {
        console.log("[AGENT] Received:", msg);
      }
    }
  }

  onError(err: Error) {
    console.error("[AGENT] Socket error:", err);
    this.cleanup();
    this.client?.destroy(); // trigger close
  }

  onClose() {
    console.log("[AGENT] Connection closed, cleaning up...");
    this.cleanup();
    this.scheduleReconnect();
  }

  cleanup() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.pongCheckInterval) clearInterval(this.pongCheckInterval);
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.heartbeatInterval = null;
    this.pongCheckInterval = null;
    this.statsInterval = null;
  }

  scheduleReconnect() {
    console.log(`[AGENT] Reconnecting in ${this.reconnectDelay / 1000}s...`);
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay,
    );
  }

  writeLog(type: string, data: unknown) {
    if (!this.client || this.client.destroyed) return;

    const logEntry = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    this.client.write(`${JSON.stringify(logEntry)}\n`);
  }
}

const agent = new AgentClient("127.0.0.1", 7001);
agent.connect();
export default agent;
