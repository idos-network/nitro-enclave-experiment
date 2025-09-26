import net from "net";
import os from "os";
import pm2 from "pm2";

function pm2Stats() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        return reject(err);
      }

      const stats = [];

      pm2.list((err, list) => {
        if (err) return reject(err);

        list.forEach(proc => {
          stats.push({
            name: proc.name,
            pid: proc.pid,
            status: proc.pm2_env.status,
            cpu: proc.monit.cpu,
            memory: proc.monit.memory,
          });
        });
        pm2.disconnect();
        resolve(stats);
      });
    });
  });
}

const client = net.createConnection({ host: "127.0.0.7", port: 7001 }, () => {
  console.log("[AGENT] Connected to host via socat/vsock");

  setInterval(() => {
    console.log("[AGENT] Sending stats to host");

    const info = {
      type: "os",
      data: {
        loadavg: os.loadavg()[0], // 1 minute load average
        memUsed: os.totalmem() - os.freemem(),
        memTotal: os.totalmem(),
      },
    };
    client.write(JSON.stringify(info) + "\n");

    pm2Stats().then(stats => {
      const pm2Info = {
        type: "pm2",
        data: stats,
      };
      client.write(JSON.stringify(pm2Info) + "\n");
    }).catch(err => {
      console.error("Failed to get PM2 stats", err);
    });
  }, 5000);
});

client.on("error", (err) => {
  console.error("Socket error:", err);
  process.exit(1); // PM2 will restart the process
});

function writeLog(type, data) {
  const logEntry = {
    type,
    data,
    timestamp: new Date().toISOString(),
  };

  client.write(JSON.stringify(logEntry) + "\n");
}

export { writeLog };
export default client;