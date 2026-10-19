import express, { type Response } from "express";

import { sessionKeyMiddleware } from "./middleware/session-key.ts";
import { validatorMiddleware } from "./middleware/validator.ts";
import { deleteSession, getSession } from "./providers/db.ts";
import { decrypt, encrypt } from "./providers/encryption.ts";
import { getEncryptionKeyPair } from "./providers/keys.ts";
import { getPublicKeyJWK } from "./providers/kms.ts";
import { createSession } from "./providers/session.ts";
import { createApp, errorHandler } from "./shared/node/app.ts";
import {
  type CommonRequest,
  CommonRequestSchema,
  type CreateSessionRequest,
  CreateSessionRequestSchema,
  type DecryptRequest,
  DecryptRequestSchema,
  type EncryptRequest,
  EncryptRequestSchema,
  type RevokeSessionRequest,
  RevokeSessionRequestSchema,
} from "./utils/dto.ts";
import { writeLog } from "./utils/logger-context.ts";
import { splitPayload } from "./utils/payload.ts";

const app = createApp("Enclave Service");
app.use(express.json({ limit: "32mb" }));

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
  "/session/revoke",
  validatorMiddleware(RevokeSessionRequestSchema),
  async (_req, res: Response<any, { validatedBody: RevokeSessionRequest }>) => {
    const { id, encryptedKey, nonce } = res.locals.validatedBody.session;

    const session = await getSession(id);
    // Same 404 for missing and unproven sessions, so revoke can't probe session ids.
    if (
      !session ||
      !getEncryptionKeyPair(
        encryptedKey,
        nonce,
        session.sessionClientPublicKey,
        session.sessionServerPrivateKey,
      )
    ) {
      return res.status(404).json({ error: "Session not found" });
    }

    await deleteSession(id);
    writeLog("session_revoked", { sessionId: id });
    return res.status(204).end();
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

app.use(errorHandler);

export default app;
