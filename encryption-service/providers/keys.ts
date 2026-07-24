import tweetnacl, { type BoxKeyPair } from "tweetnacl";
import type { DataRequest } from "../utils/dto.ts";

export async function getEncryptionKeyPair(
	sessionClientPublicKey: Buffer,
	sessionServerPrivateKey: Buffer,
	request: DataRequest["session"],
): Promise<BoxKeyPair | null> {
	const sessionServerKeyPair = tweetnacl.box.keyPair.fromSecretKey(
		sessionServerPrivateKey,
	);

	const secretKey = tweetnacl.box.open(
		Buffer.from(request.encryptedKey, "base64"),
		Buffer.from(request.nonce, "base64"),
		sessionClientPublicKey,
		sessionServerKeyPair.secretKey,
	);

	if (!secretKey) {
		return null;
	}

	return tweetnacl.box.keyPair.fromSecretKey(secretKey);
}
