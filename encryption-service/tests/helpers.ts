import nacl from "tweetnacl";

export function b64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

/** Wrap a user secret key to the session public key (client-side NaCl box). */
export function wrapUserKey(
	userSecretKey: Uint8Array,
	sessionPublicKeyB64: string,
) {
	const wrapKeyPair = nacl.box.keyPair();
	const nonce = nacl.randomBytes(nacl.box.nonceLength);
	const encryptedKey = nacl.box(
		userSecretKey,
		nonce,
		Buffer.from(sessionPublicKeyB64, "base64"),
		wrapKeyPair.secretKey,
	);

	if (!encryptedKey) {
		throw new Error("Failed to wrap user key");
	}

	return {
		encryptedKey: b64(encryptedKey),
		nonce: b64(nonce),
		publicKey: b64(wrapKeyPair.publicKey),
	};
}

export function sessionBody(
	sessionId: string,
	sessionPublicKeyB64: string,
	userKeyPair: nacl.BoxKeyPair,
	opts: { data?: string; publicKey?: string } = {},
) {
	return {
		sessionId,
		wrappedUserKey: wrapUserKey(userKeyPair.secretKey, sessionPublicKeyB64),
		data: opts.data ?? b64(Buffer.from("unused")),
		publicKey: opts.publicKey ?? b64(nacl.box.keyPair().publicKey),
	};
}
