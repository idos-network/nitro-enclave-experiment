import tweetnacl from "tweetnacl";
import { SIGNING_KEY_KMS_KEY_ID } from "../env.ts";
import { storeSession } from "./db.ts";
import { sign } from "./kms.ts";

export async function createSession(publicKey: string) {
	// 1. Generate unique Session ID
	const sessionId = crypto.randomUUID();

	// 2. Generate Ephemeral X25519 Encryption Keys
	const encryptionKeyPair = tweetnacl.box.keyPair();
	const encryptionPublicKey = {
		kty: "OKP",
		crv: "X25519",
		x: Buffer.from(encryptionKeyPair.publicKey).toString("base64url"),
	};

	// 3. Define and Strict-Encode the JWS Protected Header
	const protectedDecoded = {
		kid: SIGNING_KEY_KMS_KEY_ID,
		// TODO: I'd also maybe add jku here
		alg: "EdDSA",
		b64: false,
		crit: ["b64"], // Standard JWS requires declaring "b64" in "crit" when false
	};

	// Convert header to its Base64Url representation
	const protectedBase64Url = Buffer.from(
		JSON.stringify(protectedDecoded),
	).toString("base64url");

	// 4. Construct the Payload (Your structural nonce acts perfectly as a cryptographic salt here)
	const payload = {
		publicKeyX: encryptionPublicKey.x,
		nonce: crypto.randomUUID(), // Successfully prevents deterministic sign fingerprinting
	};
	const payloadJson = JSON.stringify(payload);

	// 5. Construct Signing Input exactly to RFC 7797 specifications:
	// Format: Base64Url(Protected) + "." + Raw_Payload
	const signingInputString = `${protectedBase64Url}.${payloadJson}`;
	const signingInputBuffer = Buffer.from(signingInputString, "utf-8");

	// 6. Execute libnacl / KMS signature calculation
	const rawSignature = await sign(signingInputBuffer);
	const signatureBase64Url = Buffer.from(rawSignature).toString("base64url");

	// 7. Output compliant Flattened JSON Serialization
	const encryptionPublicKeySignature = {
		protected: protectedBase64Url, // Stored as the encoded string
		payload: payload, // Left unencoded as a clean JSON object inside the envelope
		signature: signatureBase64Url,
	};

	// 8. Save ephemeral private state securely
	await storeSession(sessionId, encryptionKeyPair.secretKey, publicKey);

	return {
		sessionId,
		encryptionPublicKey,
		encryptionPublicKeySignature,
	};
}
