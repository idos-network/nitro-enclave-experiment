import { createWriteLog } from "@idos/tee-common/logger.ts";
import { actions } from "../providers/counters.ts";
import type { ActionType } from "./actions.ts";

export const writeLog = createWriteLog<ActionType>(actions);
