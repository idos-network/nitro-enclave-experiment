import tweetnacl, { type BoxKeyPair } from "tweetnacl";
import type { DataRequest } from "../utils/dto.ts";
import { getSession } from "./db.ts";

export async function getKeyPair(
	request: DataRequest,
): Promise<BoxKeyPair | null> {
	const session = await getSession(request.session.id);

	if (!session) {
		return null;
	}

	const ephemeralKey = tweetnacl.box.keyPair.fromSecretKey(
		session.encryptionPrivateKey,
	);

	const userPublicKey = Buffer.from(session.publicKey, "base64");

	const secretKey = tweetnacl.box.open(
		Buffer.from(request.session.wrappedEncryptionKey.payload, "base64"),
		Buffer.from(request.session.wrappedEncryptionKey.nonce, "base64"),
		userPublicKey,
		ephemeralKey.secretKey,
	);

	if (!secretKey) {
		return null;
	}

	return tweetnacl.box.keyPair.fromSecretKey(secretKey);
}
