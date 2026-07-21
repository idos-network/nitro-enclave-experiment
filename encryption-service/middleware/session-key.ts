import type { RequestHandler } from "express";
import type nacl from "tweetnacl";
import { getKeyPair } from "../providers/keys.ts";
import { RequestSchema, type Request as SessionRequest } from "../utils/dto.ts";
import { writeLog } from "../utils/logger-context.ts";

declare global {
	namespace Express {
		interface Request {
			sessionRequest: SessionRequest;
			keyPair: nacl.BoxKeyPair;
		}
	}
}

/** Parse RequestSchema and unwrap the session key pair. 400 on bad body, 404 if key pair unavailable. */
export const sessionKeyMiddleware: RequestHandler = async (req, res, next) => {
	const parsed = RequestSchema.safeParse(req.body);
	if (!parsed.success) {
		writeLog("session_request_invalid_body", { error: parsed.error });

		return res
			.status(400)
			.json({ error: "Invalid request body", details: parsed.error });
	}

	const keyPair = await getKeyPair(parsed.data);

	if (!keyPair) {
		writeLog("session_key_unavailable", {
			sessionId: parsed.data.wrappedEncryptionKey.sessionId,
		});
		return res.status(404).json({ error: "Session not found" });
	}

	req.sessionRequest = parsed.data;
	req.keyPair = keyPair;
	next();
};
