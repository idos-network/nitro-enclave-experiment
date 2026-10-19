import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { ARM_TOKENS } from "../env.ts";
import { writeLog } from "../utils/logger-context.ts";

export function bearerToken(authorization: string | undefined): string | null {
  const [scheme, token, ...rest] = authorization?.trim().split(/\s+/) ?? [];
  return scheme?.toLowerCase() === "bearer" && token && rest.length === 0 ? token : null;
}

function matchesArmToken(token: string): boolean {
  const provided = Buffer.from(token);
  // Compare against every token so timing does not reveal which one matched.
  return ARM_TOKENS.map((armToken) => {
    const expected = Buffer.from(armToken);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }).includes(true);
}

/** `Authorization: Bearer <one of ARM_TOKENS>`, otherwise 401. Fails closed when none are configured. */
export function armTokenMiddleware(): RequestHandler {
  return (req, res, next) => {
    const token = bearerToken(req.header("authorization"));

    if (!token || !matchesArmToken(token)) {
      writeLog("arm_unauthorized");
      return res.status(401).json({ error: "Invalid arm token" });
    }

    return next();
  };
}
