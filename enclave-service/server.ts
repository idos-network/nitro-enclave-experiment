import fs from "node:fs";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import promBundle from "express-prom-bundle";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";

import { sessionKeyMiddleware } from "./middleware/session-key.ts";
import { validatorMiddleware } from "./middleware/validator.ts";

import { decrypt, encrypt } from "./providers/encryption.ts";
import { getPublicKeyJWK } from "./providers/kms.ts";
import loggerMiddleware from "./providers/logger.ts";
import { createSession } from "./providers/session.ts";
import {
  type CommonRequest,
  CommonRequestSchema,
  type CreateSessionRequest,
  CreateSessionRequestSchema,
  type DecryptRequest,
  DecryptRequestSchema,
  type EncryptRequest,
  EncryptRequestSchema,
} from "./utils/dto.ts";
import { writeLog } from "./utils/logger-context.ts";
import { splitPayload } from "./utils/payload.ts";
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
app.use(express.json({ limit: "32mb" }));

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Enclave Service is running" });
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

app.get("/.well-known/jwks.json", async (_req, res) => {
  const key = await getPublicKeyJWK();
  res.status(200).json({ keys: [key] });
});

app.post(
  "/session",
  validatorMiddleware(CreateSessionRequestSchema),
  async (_req, res: Response<any, { validatedBody: CreateSessionRequest }>) => {
    const session = await createSession(res.locals.validatedBody);
    writeLog("session_created", { sessionId: session.id });
    res.status(200).json(session);
  },
);

app.post(
  "/session/public-key",
  validatorMiddleware(CommonRequestSchema),
  sessionKeyMiddleware(),
  async (
    _req,
    res: Response<any, { validatedBody: CommonRequest; encryptionKeyPair: nacl.BoxKeyPair }>,
  ) => {
    const { validatedBody, encryptionKeyPair } = res.locals;

    writeLog("public_key_request", {
      sessionId: validatedBody.session.id,
    });

    return res.json({
      sessionId: validatedBody.session.id,
      publicKey: Buffer.from(encryptionKeyPair.publicKey).toString("base64url"),
    });
  },
);

app.post(
  "/encrypt",
  validatorMiddleware(EncryptRequestSchema),
  async (_req, res: Response<any, { validatedBody: EncryptRequest }>) => {
    const { validatedBody } = res.locals;

    writeLog("encrypt_request");

    const data = await encrypt(validatedBody.arguments.payload, validatedBody.arguments.publicKey);

    return res.json(data);
  },
);

app.post(
  "/session/decrypt",
  validatorMiddleware(DecryptRequestSchema),
  sessionKeyMiddleware(),
  async (
    _req,
    res: Response<any, { validatedBody: DecryptRequest; encryptionKeyPair: nacl.BoxKeyPair }>,
  ) => {
    const { validatedBody, encryptionKeyPair } = res.locals;

    writeLog("decrypt_request", {
      sessionId: validatedBody.session.id,
    });

    // Nonce is optional
    const [payload, nonce] = splitPayload(
      validatedBody.arguments.payload,
      validatedBody.arguments.nonce,
    );

    const data = await decrypt(
      payload,
      nonce,
      validatedBody.arguments.publicKey,
      encryptionKeyPair.secretKey,
    );

    return res.json({ data });
  },
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (err instanceof Error) {
    writeLog("error", { error: err.message });
    return res.status(500).json({ error: err.message });
  }
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
