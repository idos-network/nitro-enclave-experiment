export const ACTION_TYPES = [
  "entropy_request",
  "entropy_created",
  "entropy_fetched",
  "entropy_error_missing_token",
  "entropy_error_invalid_token",
  "entropy_error_missing_iat_or_sub",
  "entropy_error_too_old",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
