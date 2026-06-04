import promClient from "prom-client";
import { ACTION_TYPES } from "../utils/actions.ts";

export const sessionStarts = new promClient.Counter({
  name: "session_starts_total",
  help: "Total number of session starts",
});

export const enrollment3dRecoverableErrors = new promClient.Counter({
  name: "enrollment3d_recoverable_errors_total",
  help: "Total number of enrollment3d recoverable errors",
});

export const ffrErrors = new promClient.Counter({
  name: "ffr_errors_total",
  help: "Total number of FFR errors",
});

export const facetecApiErrors = new promClient.Counter({
  name: "facetec_api_errors_total",
  help: "Total number of FaceTec API errors",
});

export const generalErrors = new promClient.Counter({
  name: "general_errors_total",
  help: "Total number of general errors",
});

export const actions = new promClient.Counter({
  name: "actions_total",
  help: "Total number of actions",
  labelNames: ACTION_TYPES,
});
