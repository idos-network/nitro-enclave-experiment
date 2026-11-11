import { createBearerTokenMiddleware } from "@idos/tee-common/bearer-token.ts";
import type { RequestHandler } from "express";
import { ARM_TOKENS } from "../env.ts";
import { writeLog } from "../utils/logger-context.ts";

/** `Authorization: Bearer <one of ARM_TOKENS>`, otherwise 401. Fails closed when none are configured. */
export function armTokenMiddleware(): RequestHandler {
  return createBearerTokenMiddleware({
    tokens: ARM_TOKENS,
    writeLog,
    eventType: "arm_unauthorized",
    error: "Invalid arm token",
  });
}
