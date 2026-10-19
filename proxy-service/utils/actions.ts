export const ACTION_TYPES = [
  "armed",
  "disarmed",
  "arm_unauthorized",
  "request_invalid_body",
  "proxy_armed_not_found",
  "proxy_unauthorized",
  "proxy_forbidden",
  "proxy_request",
  "proxy_upstream_failed",
  "error",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
