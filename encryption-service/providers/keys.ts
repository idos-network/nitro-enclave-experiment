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

	const sessionServerKeyPair = tweetnacl.box.keyPair.fromSecretKey(
		session.sessionServerPrivateKey,
	);

	const sessionClientPublicKey = Buffer.from(session.sessionClientPublicKey, "base64");

	const secretKey = tweetnacl.box.open(
		Buffer.from(request.session.encryptedKey, "base64"),
		Buffer.from(request.session.nonce, "base64"),
		sessionClientPublicKey,
		sessionServerKeyPair.secretKey,
	);

	if (!secretKey) {
		return null;
	}

	return tweetnacl.box.keyPair.fromSecretKey(secretKey);
}
