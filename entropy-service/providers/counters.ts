import promClient from "prom-client";
import { ACTION_TYPES } from "../utils/actions.ts";

export const actions = new promClient.Counter({
  name: "actions_total",
  help: "Total number of actions",
  labelNames: ACTION_TYPES,
});
