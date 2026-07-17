import { AsyncLocalStorage } from "node:async_hooks";
import type { Logger } from "pino";
import pino from "pino";
import { actions } from "../providers/counters.ts";
import type { ActionType } from "./actions.ts";

export const loggerStorage = new AsyncLocalStorage<Logger>();

export const getLogger = (): Logger => {
	return loggerStorage.getStore() ?? fallbackLogger;
};

// Fallback logger for places outside of HTTP requests (e.g. startup, cron jobs)
const fallbackLogger = pino({
	formatters: { level: (label) => ({ level: label }) },
});

export const writeLog = (
	eventType: ActionType,
	data: Record<string, unknown> = {},
) => {
	actions.inc({
		[eventType]: 1,
	});

	getLogger().info({
		eventType,
		...data,
	});
};
