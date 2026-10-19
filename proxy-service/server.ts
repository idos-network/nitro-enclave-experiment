import express, { type Response } from "express";

import { armTokenMiddleware } from "./middleware/arm-token.ts";
import { hostAuthMiddleware } from "./middleware/host-auth.ts";
import { validatorMiddleware } from "./middleware/validator.ts";
import { type Armed, deleteArmed, storeArmed } from "./providers/db.ts";
import { forward, isAllowed, resolveUpstreamUrl } from "./providers/proxy.ts";
import { createApp, errorHandler } from "./shared/node/app.ts";
import { type ArmRequest, ArmRequestSchema } from "./utils/dto.ts";
import { writeLog } from "./utils/logger-context.ts";

const app = createApp("Proxy Service");
// Proxied bodies are forwarded byte-for-byte (and hashed for the host signature), so keep them raw.
app.use("/proxy", express.raw({ type: () => true, limit: "32mb" }));
app.use(express.json({ limit: "32mb" }));

app.post(
  "/arm",
  armTokenMiddleware(),
  validatorMiddleware(ArmRequestSchema),
  async (_req, res: Response<any, { validatedBody: ArmRequest }>) => {
    const id = crypto.randomUUID();
    await storeArmed(id, res.locals.validatedBody);
    const { api, baseUrl } = res.locals.validatedBody;
    writeLog("armed", { armedId: id, api, baseUrl });
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

    const url = resolveUpstreamUrl(armed.baseUrl, upstreamPath);
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

app.use(errorHandler);

export default app;
