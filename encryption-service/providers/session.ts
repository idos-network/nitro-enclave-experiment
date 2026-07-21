import tweetnacl from "tweetnacl";
import { SIGNING_KEY_KMS_KEY_ID } from "../env.ts";
import { storeSession } from "./db.ts";
import { sign } from "./kms.ts";

export async function createSession() {
	const encryptionKeyPair = tweetnacl.box.keyPair();
	const timestamp = Date.now().toString();
	const nonce = Buffer.from(tweetnacl.randomBytes(16)).toString("base64");
	const sessionId = crypto.randomUUID();

	const encryptionPublicKey = Buffer.from(encryptionKeyPair.publicKey).toString(
		"base64",
	);

	const algorithm = "curve25519xsalsa20poly1305";

	const payload = encryptionPublicKey + algorithm + timestamp + nonce;

	const signature = await sign(Buffer.from(payload));

	await storeSession(sessionId, encryptionKeyPair.secretKey);

	return {
		payload: {
			encryptionPublicKey,
			algorithm,
			timestamp,
			nonce,
		},
		signature,
		sessionId,
		kid: SIGNING_KEY_KMS_KEY_ID,
	};
}
