import type { RequestHandler } from "express";
import nacl from "tweetnacl";
import type { z } from "zod";
import { verifyAudience } from "../providers/audience.ts";
import { getSession } from "../providers/db.ts";
import { getEncryptionKeyPair } from "../providers/keys.ts";
import type { CommonRequest, DataRequest } from "../utils/dto.ts";
import { writeLog } from "../utils/logger-context.ts";

declare global {
	namespace Express {
		interface Request {
			sessionRequest: CommonRequest | DataRequest;
			encryptionKeyPair: nacl.BoxKeyPair;
			audiencePublicKey: Buffer;
		}
	}
}

/**
 * Parse RequestSchema and unwrap the session key pair. 400 on bad body, 404 if key pair unavailable.
 * also check audience against the chain and signature.
 */
export function sessionKeyMiddleware(
	schema: z.ZodSchema<CommonRequest | DataRequest>,
): RequestHandler {
	return async (req, res, next) => {
		const parsed = schema.safeParse(req.body);
		if (!parsed.success) {
			writeLog("session_request_invalid_body", { error: parsed.error });

			return res
				.status(400)
				.json({ error: "Invalid request body", details: parsed.error });
		}

		const session = await getSession(parsed.data.session.id);
		if (!session) {
			return res.status(404).json({ error: "Session not found" });
		}

		const encryptionKeyPair = await getEncryptionKeyPair(
			session.sessionClientPublicKey,
			session.sessionServerPrivateKey,
			parsed.data.session,
		);
		if (!encryptionKeyPair) {
			writeLog("session_key_unavailable", {
				sessionId: session.id,
			});

			return res.status(404).json({ error: "Encryption key pair not found" });
		}

		const audiencePublicKey = await verifyAudience(
			session.allowedAudienceRoots,
			parsed.data.audience,
		);
		if (!audiencePublicKey) {
			return res.status(400).json({
				error: "Invalid audience (wrong signature, wrong chain, etc.)",
			});
		}

		req.sessionRequest = parsed.data;
		req.encryptionKeyPair = encryptionKeyPair;
		req.audiencePublicKey = audiencePublicKey;

		const originalJson = res.json.bind(res);

		res.json = (body: any) => {
			// Let errors stay readable unless you explicitly want encrypted errors too.
			if (res.statusCode >= 400) {
				return originalJson(body);
			}

			// Random box to encrypt
			const randomBox = nacl.box.keyPair();
			const nonce = nacl.randomBytes(nacl.box.nonceLength);

			const payload = nacl.box(
				Buffer.from(JSON.stringify(body), "utf8"),
				nonce,
				audiencePublicKey,
				randomBox.secretKey,
			);

			return originalJson({
				audience: {
					recipientPublicKey: {
						kty: "OKP",
						crv: "X25519",
						x: audiencePublicKey.toString("base64url"),
						use: "enc",
					},
					senderPublicKey: {
						kty: "OKP",
						crv: "X25519",
						x: Buffer.from(randomBox.publicKey).toString("base64url"),
						use: "enc",
					},
				},
				payload: Buffer.from(payload).toString("base64"),
				nonce: Buffer.from(nonce).toString("base64"),
			});
		};

		next();
	};
}
