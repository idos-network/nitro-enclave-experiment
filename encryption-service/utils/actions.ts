export const ACTION_TYPES = [
	"encrypt_request",
	"encrypt_request_missing_required_fields",
	"decrypt_request",
	"decrypt_request_missing_required_fields",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
