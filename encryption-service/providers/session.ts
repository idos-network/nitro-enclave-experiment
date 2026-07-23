import tweetnacl from "tweetnacl";
import { SIGNING_KEY_KMS_KEY_ID } from "../env.ts";
import type { CreateSessionRequest } from "../utils/dto.ts";
import { storeSession } from "./db.ts";
import { sign } from "./kms.ts";

export async function createSession(data: CreateSessionRequest) {
	// 1. Generate unique Session ID
	const sessionId = crypto.randomUUID();

	// 2. Generate Ephemeral X25519 Encryption Keys
	const encryptionKeyPair = tweetnacl.box.keyPair();
	const encryptionPublicKey = {
		kty: "OKP",
		crv: "X25519",
		x: Buffer.from(encryptionKeyPair.publicKey).toString("base64url"),
	};

	// 3. JWS protected header (RFC 7515)
	const protectedBase64Url = Buffer.from(
		JSON.stringify({
			kid: SIGNING_KEY_KMS_KEY_ID,
			alg: "EdDSA",
		}),
	).toString("base64url");

	// 4. Payload — nonce salts the signature so identical keys don't fingerprint
	const payloadBase64Url = Buffer.from(
		JSON.stringify({
			publicKeyX: encryptionPublicKey.x,
			nonce: crypto.randomUUID(),
		}),
	).toString("base64url");

	// 5. Signing input: base64url(header) + "." + base64url(payload)
	const signingInputBuffer = Buffer.from(
		`${protectedBase64Url}.${payloadBase64Url}`,
		"utf-8",
	);

	// 6. Sign via KMS
	const rawSignature = await sign(signingInputBuffer);
	const signatureBase64Url = Buffer.from(rawSignature).toString("base64url");

	// 7. Flattened JWS JSON Serialization (RFC 7515 §7.2.2)
	const encryptionPublicKeySignature = {
		protected: protectedBase64Url,
		payload: payloadBase64Url,
		signature: signatureBase64Url,
	};

	// 8. Save ephemeral private state securely
	await storeSession(
		sessionId,
		encryptionKeyPair.secretKey,
		data.sessionClientPublicKey,
		data.allowedAudienceRoots,
	);

	return {
		sessionId,
		encryptionPublicKey,
		encryptionPublicKeySignature,
	};
}
