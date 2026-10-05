import app from "./server.ts";

const PORT = process.env.PORT ?? 7000;

const server = app.listen(PORT, () => {
  console.log(`Server started and listening on port ${PORT}`);
});

server.on("error", (err) => {
  if ("code" in err && err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Please choose another port or stop the process using it.`,
    );
  } else {
    console.error("Failed to start server:", err);
  }
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => process.exit(0));

  // Don't let a hanging request block the shutdown forever.
  setTimeout(() => {
    console.error("Graceful shutdown timed out, forcing exit");
    server.closeAllConnections();
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
