import type { RequestHandler } from "express";
import nacl from "tweetnacl";
import { verifyAudience } from "../providers/audience.ts";
import { getSession } from "../providers/db.ts";
import { getEncryptionKeyPair } from "../providers/keys.ts";
import type { CommonRequest, DecryptRequest } from "../utils/dto.ts";
import { writeLog } from "../utils/logger-context.ts";

/**
 * Unwrap the session key pair. 404 if key pair unavailable.
 * also check audience against the chain and signature.
 */
export function sessionKeyMiddleware(): RequestHandler {
  return async (_req, res, next) => {
    const sessionRequest = res.locals.validatedBody as CommonRequest | DecryptRequest;

    if (!sessionRequest) {
      return res.status(400).json({ error: "Missing session request." });
    }

    const session = await getSession(sessionRequest.session.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const encryptionKeyPair = await getEncryptionKeyPair(
      sessionRequest.session.encryptedKey,
      sessionRequest.session.nonce,
      session.sessionClientPublicKey,
      session.sessionServerPrivateKey,
    );

    if (!encryptionKeyPair) {
      writeLog("session_key_unavailable", {
        sessionId: session.id,
      });

      return res
        .status(404)
        .json({ error: "Provided encryption key pair, can't be decrypted by session keys." });
    }

    const audiencePublicKey = await verifyAudience(
      session.allowedAudienceRoots,
      sessionRequest.audience.jwtChain,
    );
    if (!audiencePublicKey) {
      return res.status(400).json({
        error: "Invalid audience (wrong signature, wrong chain, etc.)",
      });
    }

    res.locals.encryptionKeyPair = encryptionKeyPair;

    const originalJson = res.json.bind(res);

    res.json = (body: any) => {
      // Let errors stay readable unless you explicitly want encrypted errors too.
      if (res.statusCode >= 400) {
        return originalJson(body);
      }

      // Random box to encrypt
      const nonce = nacl.randomBytes(nacl.box.nonceLength);

      const payload = nacl.box(
        Buffer.from(JSON.stringify(body), "utf8"),
        nonce,
        audiencePublicKey,
        session.sessionServerPrivateKey,
      );

      return originalJson({
        audience: {
          recipient: {
            kty: "OKP",
            crv: "X25519",
            x: audiencePublicKey.toString("base64url"),
            use: "enc",
          },
          sender: {
            kty: "OKP",
            crv: "X25519",
            x: Buffer.from(session.sessionServerPublicKey).toString("base64url"),
            use: "enc",
          },
          jwtChain: session.sessionServerJwtChain,
        },
        payload: Buffer.from(payload).toString("base64url"),
        nonce: Buffer.from(nonce).toString("base64url"),
      });
    };

    next();
  };
}
