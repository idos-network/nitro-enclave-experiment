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
		const sender = nacl.box.keyPair();
		const recipient = nacl.box.keyPair();
		const plaintext = b64(Buffer.from("decrypt me"));
		const ciphertext = encrypt(sender, b64(recipient.publicKey), plaintext);

		const res = await request(app)
			.post("/session/decrypt")
			.send(
				sessionBody(
					session.sessionId,
					session.payload.encryptionPublicKey,
					recipient,
					{ data: ciphertext, publicKey: b64(sender.publicKey) },
				),
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

		const res = await request(app)
			.post("/session/decrypt")
			.send(
				sessionBody(
					missingSessionId,
					b64(nacl.box.keyPair().publicKey),
					recipient,
				),
			)
			.expect(404);

		expect(res.body).toEqual({ error: "Session not found" });
	});
});
