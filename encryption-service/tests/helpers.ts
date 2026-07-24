import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import nacl from "tweetnacl";
import type { DataRequest } from "../utils/dto.ts";
import type { CreateSessionResponse } from "./app.ts";

export function b64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

/*
 * Signing helpers
 */
export const SIGNING_KID =
	"arn:aws:kms:eu-central-1:000000000000:key/signing-test";
export const SIGNING_KEY_PAIR = generateKeyPairSync("ed25519");
export const SIGNING_PUBLIC_KEY_JWK = {
	...SIGNING_KEY_PAIR.publicKey.export({ format: "jwk" }),
	kid: SIGNING_KID,
	use: "sig",
	alg: "EdDSA",
} as const;

/*
 * Audience helpers
 */
export const AUDIENCE_SIGNING_KEY_PAIR = generateKeyPairSync("ed25519");
export const AUDIENCE_KID = crypto.randomUUID();
export const AUDIENCE_ROOT = "test.root.com";
export const AUDIENCE_SIGNING_PUBLIC_KEY_JWK = {
	...AUDIENCE_SIGNING_KEY_PAIR.publicKey.export({ format: "jwk" }),
	kid: AUDIENCE_KID,
	use: "sig",
	alg: "EdDSA",
} as const;
export const AUDIENCE_RECIPIENT_KEY_PAIR = nacl.box.keyPair();

export async function createAudience(
	recipientPublicKey: Uint8Array,
	audienceSigningKeyPair = AUDIENCE_SIGNING_KEY_PAIR,
): Promise<DataRequest["audience"]> {
	const audiencePrivateJwk = audienceSigningKeyPair.privateKey.export({
		format: "jwk",
	});

	const recipientPublicKeyX =
		Buffer.from(recipientPublicKey).toString("base64url");

	const jwtChain = await new SignJWT({ recipientPublicKeyX })
		.setProtectedHeader({ alg: "EdDSA", kid: AUDIENCE_KID })
		.setIssuedAt()
		.sign(audiencePrivateJwk);

	return {
		recipientPublicKey: {
			kty: "OKP",
			crv: "X25519",
			x: Buffer.from(recipientPublicKey).toString("base64url"),
			use: "enc",
			kid: AUDIENCE_KID,
		},
		jwtChain,
	};
}

export const audience = await createAudience(
	AUDIENCE_RECIPIENT_KEY_PAIR.publicKey,
);

export function decryptAudienceResponse(response: any) {
	const decrypted = nacl.box.open(
		Buffer.from(response.payload, "base64"),
		Buffer.from(response.nonce, "base64"),
		Buffer.from(response.audience.senderPublicKey.x, "base64"),
		AUDIENCE_RECIPIENT_KEY_PAIR.secretKey,
	);

	if (!decrypted) {
		throw new Error("Failed to decrypt payload");
	}

	return JSON.parse(Buffer.from(decrypted).toString("utf8"));
}

export function sessionBody(
	session: CreateSessionResponse,
	userRandomBytes: Uint8Array,
	audience: DataRequest["audience"],
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
		audience,
	};

	if (body) {
		data.arguments = body;
	}

	return data;
}
