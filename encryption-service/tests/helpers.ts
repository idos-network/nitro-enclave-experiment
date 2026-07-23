import nacl from "tweetnacl";
import type { DataRequest } from "../utils/dto.ts";
import type { CreateSessionResponse } from "./app.ts";

export function b64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

export function sessionBody(
	session: CreateSessionResponse,
	userRandomBytes: Uint8Array,
	body: DataRequest["arguments"] | undefined = undefined,
) {
	const nonce = nacl.randomBytes(nacl.box.nonceLength);

	const wrappedUserKey = nacl.box(
		userRandomBytes,
		nonce,
		session.sessionServerPublicKey,
		session.sessionClientKeyPair.secretKey,
	);

	if (!wrappedUserKey) {
		throw new Error("Failed to wrap user key");
	}

	const data: Partial<
		Omit<DataRequest, "arguments"> & { arguments?: DataRequest["arguments"] }
	> = {
		session: {
			id: session.id,
			encryptedKey: b64(wrappedUserKey),
			nonce: b64(nonce),
		},
		audience: {
			root: "https://example.com",
			identifier: "1234567890",
		},
	};

	if (body) {
		data.arguments = body;
	}

	return data;
}
