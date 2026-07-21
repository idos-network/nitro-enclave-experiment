export const ACTION_TYPES = [
	"session_created",
	"session_request_invalid_body",
	"session_key_unavailable",
	"public_key_request",
	"encrypt_request",
	"encrypt_request_invalid_body",
	"encrypt_request_missing_required_fields",
	"decrypt_request",
	"decrypt_request_missing_required_fields",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
