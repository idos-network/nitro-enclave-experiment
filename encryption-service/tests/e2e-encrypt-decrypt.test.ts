import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { app, createSession, resetMocks } from "./app.ts";
import { b64, sessionBody } from "./helpers.ts";

describe("e2e: session → encrypt → decrypt", () => {
	beforeEach(resetMocks);

	it("round-trips plaintext through HTTP encrypt then decrypt", async () => {
		const session = await createSession();
		const sessionPub = session.payload.encryptionPublicKey;

		const sender = nacl.box.keyPair();
		const recipient = nacl.box.keyPair();
		const plaintext = b64(Buffer.from("e2e roundtrip payload"));

		const encrypted = await request(app)
			.post("/session/encrypt")
			.send(
				sessionBody(session.sessionId, sessionPub, sender, {
					data: plaintext,
					publicKey: b64(recipient.publicKey),
				}),
			)
			.expect(200);

		expect(encrypted.body.data).toBeTruthy();
		expect(encrypted.body.data).not.toBe(plaintext);

		const decrypted = await request(app)
			.post("/session/decrypt")
			.send(
				sessionBody(session.sessionId, sessionPub, recipient, {
					data: encrypted.body.data,
					publicKey: b64(sender.publicKey),
				}),
			)
			.expect(200);

		expect(decrypted.body.data).toBe(plaintext);
		expect(Buffer.from(decrypted.body.data, "base64").toString()).toBe(
			"e2e roundtrip payload",
		);
	});
});
