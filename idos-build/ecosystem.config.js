module.exports = {
  apps: [
    {
      name: "ULS",
      cwd: "/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server",
      script: "index.js",
      args: "start",
      log_file: '/home/FaceTec_Custom_Server/deploy/facetec_usage_logs_server/server/logs.txt',
      time: true, // Add timestamps to logs
      wait_ready: true, // Wait for "ready" signal before considering
      listen_timeout: 15000, // Wait 15 seconds for "ready" signal
      min_uptime: 15000, // Server must run for 30 seconds for restart to occur
      max_restarts: 0, // Don't restart if app doesn't run for 'min_uptime'
      maxRestarts: 0, // Dupe of 'max_restarts' that works around a PM2 bug
    },
    {
      name: "FaceSign-SDK",
      cwd: "/home/FaceTec_Custom_Server/deploy/facesign-sdk",
      script: "npm",
      args: "start",
    },
    {
      name: "FaceTec-Custom-Server",
      cwd: "/home/FaceTec_Custom_Server/deploy",
      script: "bash",
      args: "-c 'sleep 5 && java -jar FaceTec-Custom-Server.jar'",
      wait_ready: true,
      autorestart: true,
    },
  ],
};
