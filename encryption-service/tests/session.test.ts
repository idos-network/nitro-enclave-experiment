import { beforeEach, describe, expect, it } from "vitest";
import {
	createSession,
	resetMocks,
	SIGNING_KID,
	sessions,
	sign,
	storeSession,
} from "./app.ts";

describe("POST /session", () => {
	beforeEach(resetMocks);

	it("stores key in mocked mongo and signs via mocked KMS", async () => {
		const session = await createSession();

		const publicKey = Buffer.from(
			session.sessionClientKeyPair.publicKey,
		).toString("base64");

		expect(sign()).toHaveBeenCalledOnce();
		expect(storeSession()).toHaveBeenCalledOnce();
		expect(storeSession().mock.calls[0]?.[0]).toBe(session.id);
		expect(storeSession().mock.calls[0]?.[2]).toBe(publicKey);
		expect(sessions().get(session.id)?.publicKey).toBe(publicKey);

		const { encryptionPublicKey, encryptionPublicKeySignature } =
			session.response;

		expect(encryptionPublicKey).toEqual({
			kty: "OKP",
			crv: "X25519",
			x: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
		});

		expect(encryptionPublicKeySignature.payload).toEqual({
			publicKeyX: encryptionPublicKey.x,
			nonce: expect.any(String),
		});

		const protectedHeader = JSON.parse(
			Buffer.from(encryptionPublicKeySignature.protected, "base64url").toString(
				"utf8",
			),
		);

		expect(protectedHeader).toEqual({
			kid: SIGNING_KID,
			alg: "EdDSA",
			b64: false,
			crit: ["b64"],
		});

		const expectedSigningInput = `${encryptionPublicKeySignature.protected}.${JSON.stringify(encryptionPublicKeySignature.payload)}`;
		const signed = sign().mock.calls[0]?.[0];
		expect(signed).toBeInstanceOf(Uint8Array);
		expect(Buffer.from(signed!).toString("utf8")).toBe(expectedSigningInput);

		expect(encryptionPublicKeySignature.signature).toBe(
			Buffer.from("mock-kms-signature").toString("base64url"),
		);
	});

	it("returns a unique session each call", async () => {
		const a = await createSession();
		const b = await createSession();

		expect(a.id).not.toBe(b.id);
		expect(sessions().size).toBe(2);
	});
});
