import fs from "node:fs";
import process from "node:process";
import cors from "cors";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import promBundle from "express-prom-bundle";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import loggerMiddleware from "./logger.ts";
import { writeLog } from "./logger-context.ts";
import { runWithRequestContext } from "./request-context.ts";

const okHealth: RequestHandler = (_req, res) => {
  res.status(200).json({ status: "ok" });
};

// Request context, logging, metrics, helmet, CORS, "/", "/health" and the OpenAPI docs.
// Body parsers, routes and the error handler are added by each service afterwards.
export function createApp(name: string, health: RequestHandler = okHealth): Express {
  const app: Express = express();

  app.use((req, res, next) => {
    const requestId = req.header("x-request-id") || crypto.randomUUID();
    res.setHeader("x-request-id", requestId);
    runWithRequestContext(
      { requestId, ...(req.ip !== undefined ? { remoteIp: req.ip } : {}) },
      next,
    );
  });

  app.use(loggerMiddleware);
  app.set("trust proxy", "loopback");
  app.use(promBundle({ includeMethod: true }));
  app.use(helmet());
  app.use(cors());

  app.get("/", (_req, res) => {
    res.status(200).json({ message: `${name} is running` });
  });

  app.get("/health", health);

  if (process.env.NODE_ENV !== "test") {
    const file = fs.readFileSync("./openapi.yaml", "utf8");
    const swaggerDocument = YAML.parse(file);

    app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    app.get("/openapi.json", (_req, res) => {
      res.json(swaggerDocument);
    });
    app.get("/openapi.yaml", (_req, res) => {
      res.type("text/yaml");
      res.send(file);
    });
  }

  return app;
}

// Log everything, but never leak internals (AWS/KMS/Mongo messages) to the client.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  writeLog("error", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: "Internal server error" });
};

export function listen(app: Express) {
  const PORT = process.env.PORT || 7000;

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
}
