import { writeLog as sharedWriteLog } from "../shared/node/logger-context.ts";
import type { ActionType } from "./actions.ts";

export const writeLog: (eventType: ActionType, data?: Record<string, unknown>) => void =
  sharedWriteLog;
