import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function bearerToken(authorization: string | undefined): string | null {
  const [scheme, token, ...rest] = authorization?.trim().split(/\s+/) ?? [];
  return scheme?.toLowerCase() === "bearer" && token && rest.length === 0 ? token : null;
}

function matchesAnyToken(tokens: string[], token: string): boolean {
  const provided = Buffer.from(token);
  // Compare against every token so timing does not reveal which one matched.
  return tokens
    .map((candidate) => {
      const expected = Buffer.from(candidate);
      return expected.length === provided.length && timingSafeEqual(expected, provided);
    })
    .includes(true);
}

/**
 * `Authorization: Bearer <one of tokens>`, otherwise logs `eventType` and answers 401 with `error`.
 * Fails closed when no tokens are configured. Takes the service's writeLog because the action counter lives in the service.
 */
export function createBearerTokenMiddleware<Action extends string>(options: {
  tokens: string[];
  writeLog: (eventType: Action) => void;
  eventType: Action;
  error: string;
}): RequestHandler {
  const { tokens, writeLog, eventType, error } = options;

  return (req, res, next) => {
    const token = bearerToken(req.header("authorization"));

    if (!token || !matchesAnyToken(tokens, token)) {
      writeLog(eventType);
      return res.status(401).json({ error });
    }

    return next();
  };
}
