import tweetnacl, { type BoxKeyPair } from "tweetnacl";
import type { Request } from "../utils/dto.ts";
import { getSession } from "./db.ts";

export async function getKeyPair(request: Request): Promise<BoxKeyPair | null> {
	const session = await getSession(request.wrappedEncryptionKey.sessionId);

	if (!session) {
		return null;
	}

	const ephemeralKey = tweetnacl.box.keyPair.fromSecretKey(
		session.encryptionPrivateKey,
	);

	const userPublicKey = Buffer.from(session.publicKey, "base64");

	const secretKey = tweetnacl.box.open(
		Buffer.from(request.wrappedEncryptionKey.encryptedKey, "base64"),
		Buffer.from(request.wrappedEncryptionKey.nonce, "base64"),
		userPublicKey,
		ephemeralKey.secretKey,
	);

	if (!secretKey) {
		return null;
	}

	return tweetnacl.box.keyPair.fromSecretKey(secretKey);
}
