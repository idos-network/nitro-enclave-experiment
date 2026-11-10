import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { getRequestId } from "./request-context.ts";

const loggerStorage = new AsyncLocalStorage<Logger>();

// Fallback logger for places outside of HTTP requests (e.g. startup, cron jobs)
const fallbackLogger = pino({
  formatters: { level: (label) => ({ level: label }) },
});

export const getLogger = (): Logger => {
  return loggerStorage.getStore() ?? fallbackLogger;
};

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

export function loggerMiddleware(req: Request, res: Response, next: NextFunction) {
  logger(req, res, () => {
    loggerStorage.run(req.log, next);
  });
}
