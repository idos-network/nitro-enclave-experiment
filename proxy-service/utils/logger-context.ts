import { getLogger } from "@idos/tee-common/logger.ts";
import { actions } from "../providers/counters.ts";
import type { ActionType } from "./actions.ts";

export const writeLog = (eventType: ActionType, data: Record<string, unknown> = {}) => {
  actions.inc({ action: eventType });

  getLogger().info({
    eventType,
    ...data,
  });
};
