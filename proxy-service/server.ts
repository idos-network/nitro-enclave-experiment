import fs from "node:fs";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import promBundle from "express-prom-bundle";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";

import { armTokenMiddleware } from "./middleware/arm-token.ts";
import { hostAuthMiddleware } from "./middleware/host-auth.ts";
import { validatorMiddleware } from "./middleware/validator.ts";
import { type Armed, deleteArmed, storeArmed } from "./providers/db.ts";
import loggerMiddleware from "./providers/logger.ts";
import { forward, isAllowed, resolveUpstreamUrl } from "./providers/proxy.ts";
import { vendors } from "./providers/vendors/index.ts";
import { type ArmRequest, ArmRequestSchema } from "./utils/dto.ts";
import { writeLog } from "./utils/logger-context.ts";
import { runWithRequestContext } from "./utils/request-context.ts";

const app: Express = express();

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  runWithRequestContext({ requestId, ...(req.ip !== undefined ? { remoteIp: req.ip } : {}) }, next);
});

app.use(loggerMiddleware);
app.set("trust proxy", "loopback");
app.use(promBundle({ includeMethod: true }));
app.use(helmet());
app.use(cors());
// Proxied bodies are forwarded byte-for-byte (and hashed for the host signature), so keep them raw.
app.use("/proxy", express.raw({ type: () => true, limit: "32mb" }));
app.use(express.json({ limit: "32mb" }));

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Proxy Service is running" });
});

app.get("/health", async (_req, res) => {
  res.status(200).json({ status: "ok" });
});

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

app.post(
  "/arm",
  armTokenMiddleware(),
  validatorMiddleware(ArmRequestSchema),
  async (_req, res: Response<any, { validatedBody: ArmRequest }>) => {
    const id = crypto.randomUUID();
    await storeArmed(id, res.locals.validatedBody);
    const { api, environment } = res.locals.validatedBody;
    writeLog("armed", { armedId: id, api, environment });
    res.status(200).json({ id });
  },
);

app.delete("/arm/:id", armTokenMiddleware(), async (req, res) => {
  const armedId = String(req.params.id);
  const deleted = await deleteArmed(armedId);

  if (!deleted) {
    return res.status(404).json({ error: "Armed id not found" });
  }

  writeLog("disarmed", { armedId });
  return res.status(204).end();
});

app.all(
  "/proxy/:id/{*path}",
  hostAuthMiddleware(),
  async (req, res: Response<any, { armed: Armed; upstreamPath: string }>) => {
    const { armed, upstreamPath } = res.locals;

    const url = resolveUpstreamUrl(vendors[armed.api].origins[armed.environment], upstreamPath);
    if (!url || !isAllowed(armed.allow, req.method, url.pathname)) {
      writeLog("proxy_forbidden", { armedId: armed.id, method: req.method, path: upstreamPath });
      return res.status(403).json({ error: `${req.method} ${upstreamPath} is not allowed` });
    }

    writeLog("proxy_request", { armedId: armed.id, method: req.method, path: upstreamPath });

    let upstream: Awaited<ReturnType<typeof forward>>;
    try {
      upstream = await forward(armed, req, url);
    } catch (error) {
      writeLog("proxy_upstream_failed", {
        armedId: armed.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(502).json({ error: "Upstream request failed" });
    }

    res.status(upstream.status);
    if (upstream.contentType) res.type(upstream.contentType);
    return res.send(upstream.body);
  },
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Log everything, but never leak internals (AWS/KMS/Mongo messages) to the client.
  writeLog("error", { error: err instanceof Error ? err.message : String(err) });
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
