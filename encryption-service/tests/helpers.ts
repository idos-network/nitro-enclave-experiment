import nacl from "tweetnacl";
import type { CreateSessionResponse } from "./app.ts";

export function b64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

export function sessionBody(
	session: CreateSessionResponse,
	userRandomBytes: Uint8Array,
	opts: { data?: string; publicKey?: string } = {},
) {
	const nonce = nacl.randomBytes(nacl.box.nonceLength);

	const wrappedUserKey = nacl.box(
		userRandomBytes,
		nonce,
		session.serverPublicKey,
		session.sessionClientKeyPair.secretKey,
	);

	if (!wrappedUserKey) {
		throw new Error("Failed to wrap user key");
	}

	return {
		wrappedEncryptionKey: {
			sessionId: session.id,
			encryptedKey: b64(wrappedUserKey),
			nonce: b64(nonce),
		},
		data: opts.data ?? b64(Buffer.from("unused")),
		publicKey: opts.publicKey ?? b64(nacl.box.keyPair().publicKey),
	};
}
