import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { app, createSession, resetMocks } from "./app.ts";
import {
	audience,
	b64,
	decryptAudienceResponse,
	sessionBody,
} from "./helpers.ts";

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
				sessionBody(sessionUser, contentEncryptionKeyPair.secretKey, audience, {
					payload: plaintext,
					// Encrypt for the recipient
					publicKey: b64(recipientKeyPair.publicKey),
				}),
			)
			.expect(200);

		expect(encrypted.body).toEqual({
			audience: {
				recipientPublicKey: {
					x: audience.recipientPublicKey.x,
					kty: "OKP",
					crv: "X25519",
					use: "enc",
				},
				senderPublicKey: {
					x: expect.any(String),
					kty: "OKP",
					crv: "X25519",
					use: "enc",
				},
			},
			payload: expect.any(String),
			nonce: expect.any(String),
		});

		const decryptedResponse = decryptAudienceResponse(encrypted.body);
		expect(decryptedResponse).toEqual({
			data: expect.any(String),
		});

		const decrypted = await request(app)
			.post("/session/decrypt")
			.send(
				sessionBody(sessionRecipient, recipientKeyPair.secretKey, audience, {
					payload: decryptedResponse.data,
					// nonce: b64(encrypted.body.nonce),
					// Recipient can decrypt
					publicKey: b64(contentEncryptionKeyPair.publicKey),
				}),
			)
			.expect(200);

		const decryptedPayload = decryptAudienceResponse(decrypted.body);
		expect(decryptedPayload.data).toBe(plaintext);
	});
});
