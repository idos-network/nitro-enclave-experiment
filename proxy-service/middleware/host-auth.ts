import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { errors, importJWK, jwtVerify } from "jose";
import { HOST_JWS_MAX_AGE } from "../env.ts";
import { type Armed, getArmed } from "../providers/db.ts";
import { writeLog } from "../utils/logger-context.ts";
import { bearerToken } from "./arm-token.ts";

/** Path (with query) the host addressed on the vendor, i.e. everything after `/proxy/:id`. */
export function upstreamPath(url: string, armedId: string): string {
  return url.slice(`/proxy/${armedId}`.length);
}

/**
 * Loads the armed record (404) and verifies the host's EdDSA JWS from
 * `Authorization: Bearer` (401). The JWS binds method, path and body hash,
 * so a captured token cannot be replayed against another call.
 */
export function hostAuthMiddleware(): RequestHandler {
  return async (req, res, next) => {
    const armedId = String(req.params.id);
    const armed = await getArmed(armedId);

    if (!armed) {
      writeLog("proxy_armed_not_found", { armedId });
      return res.status(404).json({ error: "Armed id not found" });
    }

    const jws = bearerToken(req.header("authorization"));
    if (!jws) {
      writeLog("proxy_unauthorized", { armedId, error: "missing bearer" });
      return res.status(401).json({ error: "Missing host signature" });
    }

    const path = upstreamPath(req.url, armedId);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const error = await verifyHostJws(armed, jws, req.method, path, body);

    if (error) {
      writeLog("proxy_unauthorized", { armedId, error });
      return res.status(401).json({ error: "Invalid host signature" });
    }

    res.locals.armed = armed;
    res.locals.upstreamPath = path;
    return next();
  };
}

/** Returns a reason string when the JWS is not valid for this exact request, null when it is. */
async function verifyHostJws(
  armed: Armed,
  jws: string,
  method: string,
  path: string,
  body: Buffer,
): Promise<string | null> {
  const key = await importJWK({ kty: "OKP", crv: "Ed25519", x: armed.hostPublicKey }, "EdDSA");

  try {
    const { payload } = await jwtVerify(jws, key, {
      algorithms: ["EdDSA"],
      maxTokenAge: HOST_JWS_MAX_AGE,
      requiredClaims: ["iat", "exp", "method", "path", "bodySha256"],
    });

    if (payload.method !== method) return "method mismatch";
    if (payload.path !== path) return "path mismatch";
    if (payload.bodySha256 !== createHash("sha256").update(body).digest("base64url")) {
      return "body hash mismatch";
    }

    return null;
  } catch (error) {
    if (error instanceof errors.JOSEError) return error.code;
    throw error;
  }
}
