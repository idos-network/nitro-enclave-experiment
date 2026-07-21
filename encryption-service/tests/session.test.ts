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
		const body = await createSession();

		expect(sign()).toHaveBeenCalledOnce();
		expect(storeSession()).toHaveBeenCalledOnce();
		expect(storeSession().mock.calls[0]?.[0]).toBe(body.sessionId);
		expect(sessions().has(body.sessionId)).toBe(true);

		const expectedPayload =
			body.payload.encryptionPublicKey +
			body.payload.algorithm +
			body.payload.timestamp +
			body.payload.nonce;
		const signed = sign().mock.calls[0]?.[0];
		expect(signed).toBeInstanceOf(Uint8Array);
		expect(Buffer.from(signed!).toString("utf8")).toBe(expectedPayload);

		expect(body.signature).toBe("mock-kms-signature");
		expect(body.kid).toBe(SIGNING_KID);
		expect(body.payload.algorithm).toBe("curve25519xsalsa20poly1305");
		expect(body.payload.encryptionPublicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
	});

	it("returns a unique session each call", async () => {
		const a = await createSession();
		const b = await createSession();

		expect(a.sessionId).not.toBe(b.sessionId);
		expect(sessions().size).toBe(2);
	});
});
