import tweetnacl, { type BoxKeyPair } from "tweetnacl";
import type { Request } from "../utils/dto.ts";
import { getSession } from "./db.ts";

export async function getKeyPair(request: Request): Promise<BoxKeyPair | null> {
	const session = await getSession(request.sessionId);
	if (!session) {
		return null;
	}

	const ephemeralKey = tweetnacl.box.keyPair.fromSecretKey(
		session.encryptionPrivateKey,
	);

	const secretKey = tweetnacl.box.open(
		Buffer.from(request.wrappedUserKey.encryptedKey, "base64"),
		Buffer.from(request.wrappedUserKey.nonce, "base64"),
		Buffer.from(request.wrappedUserKey.publicKey, "base64"),
		ephemeralKey.secretKey,
	);

	if (!secretKey) {
		return null;
	}

	return tweetnacl.box.keyPair.fromSecretKey(secretKey);
}
