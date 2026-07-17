import type { RequestHandler } from "express";
import type { z } from "zod";
import type {
  CommonRequest,
  CreateSessionRequest,
  DecryptRequest,
  EncryptRequest,
} from "../utils/dto.ts";
import { writeLog } from "../utils/logger-context.ts";

declare global {
  namespace Express {
    interface Request {
      sessionRequest: CreateSessionRequest | EncryptRequest | DecryptRequest | CommonRequest;
    }
  }
}

/**
 *
 * Parse RequestSchema and return 400 on bad body
 */
export function validatorMiddleware(
  schema: z.ZodSchema<CreateSessionRequest | EncryptRequest | DecryptRequest | CommonRequest>,
): RequestHandler {
  return async (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      writeLog("session_request_invalid_body", { error: parsed.error });

      const issues = parsed.error.issues.map(({ path, code }) => ({
        path: path.join("."),
        code,
      }));

      return res.status(400).json({ error: "Invalid request body", details: issues });
    }

    req.sessionRequest = parsed.data;
    return next();
  };
}
