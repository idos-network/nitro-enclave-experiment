import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { app, createSession, resetMocks } from "./app.ts";
import { b64, sessionBody } from "./helpers.ts";

describe("e2e: session → encrypt → decrypt", () => {
	beforeEach(resetMocks);

	it("round-trips plaintext through HTTP encrypt then decrypt", async () => {
		const sessionUser = await createSession();
		const sessionRecipient = await createSession();

		const contentEncryptionKeyPair = nacl.box.keyPair();
		const recipientKeyPair = nacl.box.keyPair();

		const plaintext = b64(Buffer.from("e2e roundtrip payload"));

		const encrypted = await request(app)
			.post("/session/encrypt")
			.send(
				sessionBody(sessionUser, contentEncryptionKeyPair.secretKey, {
					payload: plaintext,
					// Encrypt for the recipient
					publicKey: b64(recipientKeyPair.publicKey),
				}),
			)
			.expect(200);

		expect(encrypted.body.data).toBeTruthy();
		expect(encrypted.body.data).not.toBe(plaintext);

		const decrypted = await request(app)
			.post("/session/decrypt")
			.send(
				sessionBody(sessionRecipient, recipientKeyPair.secretKey, {
					payload: encrypted.body.data,
					// nonce: b64(encrypted.body.nonce),
					// Recipient can decrypt
					publicKey: b64(contentEncryptionKeyPair.publicKey),
				}),
			)
			.expect(200);

		expect(decrypted.body.data).toBe(plaintext);
		expect(Buffer.from(decrypted.body.data, "base64").toString()).toBe(
			"e2e roundtrip payload",
		);
	});
});
