import fs from "node:fs";
import cors from "cors";
import express, { type Express } from "express";
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

app.use(loggerMiddleware);

app.set("trust proxy", "loopback");

app.use(
  promBundle({
    includeMethod: true,
  }),
);

app.use(helmet());
app.use(cors());
app.use((req, res, next) => {
  const requestId = req.header("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  runWithRequestContext({ requestId, ...(req.ip !== undefined ? { remoteIp: req.ip } : {}) }, next);
});
app.use(express.json({ limit: "32mb" }));

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Enclave Service is running" });
});

app.get("/health", async (_req, res) => {
  res.status(200).json({ status: "ok" });
});

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

app.get("/.well-known/jwks.json", async (_req, res) => {
  const key = await getPublicKeyJWK();
  res.status(200).json({ keys: [key] });
});

app.post("/session", validatorMiddleware(CreateSessionRequestSchema), async (req, res) => {
  const sessionRequest = req.sessionRequest as CreateSessionRequest;
  const session = await createSession(sessionRequest);
  writeLog("session_created", { sessionId: session.id });
  res.status(200).json(session);
});

app.post(
  "/session/public-key",
  validatorMiddleware(CommonRequestSchema),
  sessionKeyMiddleware(),
  async (req, res) => {
    const sessionRequest = req.sessionRequest as CommonRequest;

    writeLog("public_key_request", {
      sessionId: sessionRequest.session.id,
    });

    return res.json({
      sessionId: sessionRequest.session.id,
      publicKey: Buffer.from(req.encryptionKeyPair.publicKey).toString("base64url"),
    });
  },
);

app.post("/encrypt", validatorMiddleware(EncryptRequestSchema), async (req, res) => {
  const sessionRequest = req.sessionRequest as EncryptRequest;

  writeLog("encrypt_request");

  const data = await encrypt(sessionRequest.arguments.payload, sessionRequest.arguments.publicKey);

  return res.json(data);
});

app.post(
  "/session/decrypt",
  validatorMiddleware(DecryptRequestSchema),
  sessionKeyMiddleware(),
  async (req, res) => {
    const sessionRequest = req.sessionRequest as DecryptRequest;

    writeLog("decrypt_request", {
      sessionId: sessionRequest.session.id,
    });

    // Nonce is optional
    const [payload, nonce] = splitPayload(
      sessionRequest.arguments.payload,
      sessionRequest.arguments.nonce,
    );

    const data = await decrypt(
      payload,
      nonce,
      sessionRequest.arguments.publicKey,
      req.encryptionKeyPair.secretKey,
    );

    return res.json({ data });
  },
);

export default app;
