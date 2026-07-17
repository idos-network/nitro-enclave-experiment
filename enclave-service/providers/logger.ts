import type { NextFunction, Request, Response } from "express";
import { pinoHttp } from "pino-http";
import { loggerStorage } from "../utils/logger-context.ts";
import { getRequestId } from "../utils/request-context.ts";

const sensitiveHeaders = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-id-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-amz-security-token",
];

const sensitiveHeaderPaths = sensitiveHeaders.flatMap((header) => [
  `req.headers['${header}']`,
  `res.headers['${header}']`,
  `headers['${header}']`,
]);

const logger = pinoHttp({
  enabled: process.env.NODE_ENV !== "test",
  formatters: {
    level: (label) => ({ level: label }),
  },
  genReqId: () => getRequestId() ?? "-",
  redact: {
    paths: sensitiveHeaderPaths,
    censor: "[Redacted]",
  },
  autoLogging: {
    ignore: (req: Request) => ["/", "/metrics", "/health"].includes(req.url ?? ""),
  },
});

export default function loggerMiddleware(req: Request, res: Response, next: NextFunction) {
  logger(req, res, () => {
    loggerStorage.run(req.log, next);
  });
}
