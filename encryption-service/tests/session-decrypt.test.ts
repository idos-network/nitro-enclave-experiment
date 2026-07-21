import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "../providers/encryption.ts";
import { app, createSession, resetMocks } from "./app.ts";
import { b64, sessionBody } from "./helpers.ts";

describe("POST /session/decrypt", () => {
	beforeEach(resetMocks);

	it("decrypts a sender ciphertext", async () => {
		const session = await createSession();
		const userKeyPair = nacl.box.keyPair();
		const recipientKeyPair = nacl.box.keyPair();
		const plaintext = b64(Buffer.from("decrypt me"));
		const ciphertext = encrypt(
			userKeyPair,
			b64(recipientKeyPair.publicKey),
			plaintext,
		);

		const res = await request(app)
			.post("/session/decrypt")
			.send(
				sessionBody(session, userKeyPair.secretKey, {
					data: ciphertext,
					publicKey: b64(recipientKeyPair.publicKey),
				}),
			)
			.expect(200);

		expect(res.body.data).toBe(plaintext);
	});

	it("returns 400 for invalid body", async () => {
		const res = await request(app)
			.post("/session/decrypt")
			.send({ sessionId: "not-a-uuid" })
			.expect(400);

		expect(res.body.error).toBe("Invalid request body");
		expect(res.body.details).toBeDefined();
	});

	it("returns 404 when session is missing", async () => {
		const recipient = nacl.box.keyPair();
		const missingSessionId = crypto.randomUUID();

		const session = await createSession();
		session.id = missingSessionId;

		const res = await request(app)
			.post("/session/decrypt")
			.send(
				sessionBody(session, recipient.secretKey, {
					data: b64(Buffer.from("unused")),
					publicKey: b64(recipient.publicKey),
				}),
			)
			.expect(404);

		expect(res.body).toEqual({ error: "Session not found" });
	});
});
