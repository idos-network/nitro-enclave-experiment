import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { SESSION_TOKENS } from "../env.ts";
import { writeLog } from "../utils/logger-context.ts";

function bearerToken(authorization: string | undefined): string | null {
  const [scheme, token, ...rest] = authorization?.trim().split(/\s+/) ?? [];
  return scheme?.toLowerCase() === "bearer" && token && rest.length === 0 ? token : null;
}

function matchesSessionToken(token: string): boolean {
  const provided = Buffer.from(token);
  // Compare against every token so timing does not reveal which one matched.
  return SESSION_TOKENS.map((sessionToken) => {
    const expected = Buffer.from(sessionToken);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }).includes(true);
}

/** `Authorization: Bearer <one of SESSION_TOKENS>`, otherwise 401. Fails closed when none are configured. */
export function sessionTokenMiddleware(): RequestHandler {
  return (req, res, next) => {
    const token = bearerToken(req.header("authorization"));

    if (!token || !matchesSessionToken(token)) {
      writeLog("session_unauthorized");
      return res.status(401).json({ error: "Invalid session token" });
    }

    return next();
  };
}
