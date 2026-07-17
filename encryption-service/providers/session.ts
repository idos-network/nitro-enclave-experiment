import sodium from "libsodium-wrappers";
import { storeSession } from "./db.ts";
import { sign } from "./kms.ts";

export async function createSession() {
	// TODO: Implement session creation

	await sodium.ready;

	const encryptionKeyPair = sodium.crypto_kx_keypair();

	const timestamp = Date.now().toString();
	const nonce = sodium.randombytes_buf(16);

	// TODO: Store the encryption key pair in the database

	const payload =
		sodium.to_string(encryptionKeyPair.publicKey) +
		timestamp +
		sodium.to_base64(nonce);

	const signature = await sign(Buffer.from(payload));

	const sessionId = crypto.randomUUID();

	await storeSession(sessionId, sodium.to_string(encryptionKeyPair.privateKey));

	return {
		id: sessionId,
		encryptionPublicKey: sodium.to_base64(encryptionKeyPair.publicKey),
		timestamp,
		nonce: sodium.to_base64(nonce),
		signature: signature,
	};
}
