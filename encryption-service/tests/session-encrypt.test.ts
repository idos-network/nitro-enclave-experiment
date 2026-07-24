import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { decrypt } from "../providers/encryption.ts";
import { app, createSession, resetMocks } from "./app.ts";
import { audience, b64, decryptAudienceResponse, sessionBody } from "./helpers.ts";

describe("POST /session/encrypt", () => {
	beforeEach(resetMocks);

	it("encrypts for a recipient", async () => {
		const session = await createSession();
		const contentEncryptionKeyPair = nacl.box.keyPair();
		const recipientKeyPair = nacl.box.keyPair();
		const plaintext = b64(Buffer.from("encrypt me"));

		const res = await request(app)
			.post("/session/encrypt")
			.send(
				sessionBody(session, contentEncryptionKeyPair.secretKey, audience, {
					payload: plaintext,
					publicKey: b64(recipientKeyPair.publicKey),
				}),
			)
			.expect(200);

		const decryptedPayload = decryptAudienceResponse(res.body);

		const recovered = decrypt(
			recipientKeyPair,
			b64(contentEncryptionKeyPair.publicKey),
			decryptedPayload.data,
		);

		expect(recovered).toBe(plaintext);
	});

	it("returns 400 for invalid body", async () => {
		const res = await request(app)
			.post("/session/encrypt")
			.send({ sessionId: "not-a-uuid" })
			.expect(400);

		expect(res.body.error).toBe("Invalid request body");
		expect(res.body.details).toBeDefined();
	});

	it("returns 404 when session is missing", async () => {
		const contentEncryptionKeyPair = nacl.box.keyPair();
		const missingSessionId = crypto.randomUUID();

		const session = await createSession();
		session.id = missingSessionId;

		const res = await request(app)
			.post("/session/encrypt")
			.send(
				sessionBody(session, contentEncryptionKeyPair.secretKey, audience, {
					payload: b64(Buffer.from("encrypt me")),
					publicKey: b64(contentEncryptionKeyPair.publicKey),
				}),
			)
			.expect(404);

		expect(res.body).toEqual({ error: "Session not found" });
	});
});
