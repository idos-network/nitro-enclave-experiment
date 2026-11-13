import { readFileSync } from "node:fs";
import { loggerMiddleware } from "@idos/tee-common/logger.ts";
import { mountOpenApi } from "@idos/tee-common/openapi.ts";
import { requestContextMiddleware } from "@idos/tee-common/request-context.ts";
import { tracingMiddleware } from "@idos/tee-common/telemetry.ts";
import cors from "cors";
import express, { type Express } from "express";
import promBundle from "express-prom-bundle";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { JWT_PUBLIC_KEY } from "./env.ts";
import { consumeTokenId, fetchOrCreateFaceSignEntropy, releaseTokenId } from "./providers/db.ts";
import { writeLog } from "./utils/logger-context.ts";

const app: Express = express();

app.use(requestContextMiddleware);
app.use(tracingMiddleware);
app.use(loggerMiddleware);
app.set("trust proxy", "loopback");
// default metrics: event loop lag and utilization, GC, heap
app.use(promBundle({ includeMethod: true, promClient: { collectDefaultMetrics: {} } }));
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute
  limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minute).
  legacyHeaders: false,
  standardHeaders: false,
  ipv6Subnet: 56,
  skip: (req) => req.url.startsWith("/metrics") || req.url.startsWith("/health"),
});
app.use(limiter);

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Entropy Service is running" });
});

app.get("/health", async (_req, res) => {
  res.status(200).json({ status: "ok" });
});

mountOpenApi(app);

app.post("/facesign/entropy", async (req, res) => {
  // Validate token from body
  const token = req.body.token;

  writeLog("entropy_request");

  if (!token) {
    writeLog("entropy_error_missing_token");
    return res.status(400).json({ error: "Token is required" });
  }

  let result: { sub: string; iat: number; jti?: string };

  try {
    const publicKey = readFileSync(JWT_PUBLIC_KEY);
    result = jwt.verify(token, publicKey, {
      algorithms: ["ES512"],
      // Only attestment tokens carry this audience; confirmation tokens (same signing key) must be rejected
      audience: "entropy-service",
    }) as {
      sub: string;
      iat: number;
      jti?: string;
    };
  } catch (error) {
    writeLog("entropy_error_invalid_token", { error });
    return res.status(400).json({ error: "Invalid token" });
  }

  if (!result.iat || !result.sub || !result.jti) {
    writeLog("entropy_error_missing_iat_sub_or_jti");
    return res.status(400).json({ error: "Invalid token" });
  }

  if (Date.now() / 1000 - result.iat > 1 * 60) {
    writeLog("entropy_error_too_old", {
      iat: result.iat,
      now: Date.now() / 1000,
    });
    return res.status(400).json({ error: "Token already expired" });
  }

  // Single use: a leaked token can't be replayed within its 60s window
  if (!(await consumeTokenId(result.jti))) {
    writeLog("entropy_error_token_reused", { userId: result.sub, ip: req.ip });
    return res.status(400).json({ error: "Token already used" });
  }

  let insert: boolean;
  let entropy: string;
  try {
    ({ insert, entropy } = await fetchOrCreateFaceSignEntropy(result.sub as string));
  } catch (error) {
    // Nothing was handed out, so the token is still unspent - let it retry.
    await releaseTokenId(result.jti);
    throw error;
  }

  if (insert) {
    writeLog("entropy_created", { userId: result.sub, ip: req.ip });
  } else {
    writeLog("entropy_fetched", { userId: result.sub, ip: req.ip });
  }

  return res.json({ faceSignUserId: result.sub, entropy });
});

export default app;
