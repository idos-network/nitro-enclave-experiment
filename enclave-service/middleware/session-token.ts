import { createBearerTokenMiddleware } from "@idos/tee-common/bearer-token.ts";
import type { RequestHandler } from "express";
import { SESSION_TOKENS } from "../env.ts";
import { writeLog } from "../utils/logger-context.ts";

/** `Authorization: Bearer <one of SESSION_TOKENS>`, otherwise 401. Fails closed when none are configured. */
export function sessionTokenMiddleware(): RequestHandler {
  return createBearerTokenMiddleware({
    tokens: SESSION_TOKENS,
    writeLog,
    eventType: "session_unauthorized",
    error: "Invalid session token",
  });
}
