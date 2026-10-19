import promClient from "@prometheus-io/client";
export const actions = new promClient.Counter({
  name: "actions_total",
  help: "Total number of actions",
  labelNames: ["action"] as const,
});
