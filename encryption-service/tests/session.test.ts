import { importJWK, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createSession,
	resetMocks,
	sessions,
	sign,
	storeSession,
} from "./app.ts";
import { SIGNING_KEY_PAIR, SIGNING_KID } from "./helpers.ts";

describe("POST /session", () => {
	beforeEach(resetMocks);

	it("stores key in mocked mongo and signs via mocked KMS", async () => {
		const session = await createSession();

		const publicKey = Buffer.from(
			session.sessionClientKeyPair.publicKey,
		).toString("base64");

		// Check if mocked KMS signer was called
		expect(sign()).toHaveBeenCalledOnce();
		expect(storeSession()).toHaveBeenCalledOnce();
		expect(storeSession().mock.calls[0]?.[0]).toBe(session.id);
		expect(storeSession().mock.calls[0]?.[2]).toBe(publicKey);
		expect(sessions().get(session.id)?.sessionClientPublicKey).toBe(publicKey);

		const { sessionServerPublicKey, jwtChain } = session.response;

		expect(sessionServerPublicKey).toEqual({
			kty: "OKP",
			crv: "X25519",
			x: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
		});

		const signingPublicKey = await importJWK(
			SIGNING_KEY_PAIR.publicKey.export({ format: "jwk" }),
			"EdDSA",
		);
		const decoded = await jwtVerify(jwtChain, signingPublicKey, {
			algorithms: ["EdDSA"],
		});

		expect(decoded?.payload).toEqual({
			sessionServerPublicKeyX: sessionServerPublicKey.x,
			nonce: expect.any(String),
		});

		expect(decoded?.protectedHeader).toEqual({
			kid: SIGNING_KID.split("/")[1], // just the key ID, not the full ARN
			alg: "EdDSA",
			iss: "https://test.root.com",
		});
	});

	it("returns a unique session each call", async () => {
		const a = await createSession();
		const b = await createSession();

		expect(a.id).not.toBe(b.id);
		expect(sessions().size).toBe(2);
	});
});
