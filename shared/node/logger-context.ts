import { AsyncLocalStorage } from "node:async_hooks";
import promClient from "@prometheus-io/client";
import type { Logger } from "pino";
import pino from "pino";

export const loggerStorage = new AsyncLocalStorage<Logger>();

// Fallback logger for places outside of HTTP requests (e.g. startup, cron jobs)
const fallbackLogger = pino({
  formatters: { level: (label) => ({ level: label }) },
});

export const getLogger = (): Logger => {
  return loggerStorage.getStore() ?? fallbackLogger;
};

export const actions = new promClient.Counter({
  name: "actions_total",
  help: "Total number of actions",
  labelNames: ["action"] as const,
});

// Each service narrows eventType to its own ActionType in utils/logger-context.ts
export const writeLog = (eventType: string, data: Record<string, unknown> = {}) => {
  actions.inc({ action: eventType });

  getLogger().info({
    eventType,
    ...data,
  });
};
