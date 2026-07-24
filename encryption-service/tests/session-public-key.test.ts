import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import {
	app,
	createSession,
	getSession,
	resetMocks,
} from "./app.ts";
import { audience, b64, createAudience, decryptAudienceResponse, sessionBody } from "./helpers.ts";
import { generateKeyPairSync } from "node:crypto";

describe("POST /session/public-key", () => {
	beforeEach(resetMocks);

	it("returns the unwrapped user public key", async () => {
		const session = await createSession();

		const contentEncryptionKeyPair = nacl.box.keyPair();

		const res = await request(app)
			.post("/session/public-key")
			.send(sessionBody(session, contentEncryptionKeyPair.secretKey, audience))
			.expect(200);

		expect(getSession()).toHaveBeenCalledWith(session.id);

		expect(res.body).toEqual({
			audience: {
				recipientPublicKey: audience.recipientPublicKey,
				senderPublicKey: expect.any(String),
			},
			payload: expect.any(String),
			nonce: expect.any(String),
		});

    const decryptedPayload = decryptAudienceResponse(res.body);

		expect(decryptedPayload).toEqual({
			sessionId: session.id,
			publicKey: Buffer.from(contentEncryptionKeyPair.publicKey).toString("base64"),
		});
	});

	it("returns 400 for invalid body", async () => {
		const res = await request(app)
			.post("/session/public-key")
			.send({ sessionId: "not-a-uuid" })
			.expect(400);

		expect(res.body.error).toBe("Invalid request body");
		expect(res.body.details).toBeDefined();
	});

	it("returns 404 when session is missing", async () => {
		const missingSessionId = crypto.randomUUID();
		const session = await createSession();
		session.id = missingSessionId;

		const contentEncryptionKeyPair = nacl.box.keyPair();

		const res = await request(app)
			.post("/session/public-key")
			.send(sessionBody(session, contentEncryptionKeyPair.secretKey, audience))
			.expect(404);

		expect(res.body).toEqual({ error: "Session not found" });
		expect(getSession()).toHaveBeenCalledWith(missingSessionId);
	});

	it("returns 404 when wrappedUserKey cannot be unwrapped", async () => {
		const session = await createSession();
		session.sessionServerPublicKey = nacl.box.keyPair().publicKey;

		const body = sessionBody(session, nacl.randomBytes(32), audience);

		const res = await request(app)
			.post("/session/public-key")
			.send(body)
			.expect(404);

		expect(res.body).toEqual({ error: "Encryption key pair not found" });
	});

	it("returns 400 when audience is signed by another key", async () => {
		const session = await createSession();
		const contentEncryptionKeyPair = nacl.box.keyPair();
    const invalidAudienceSigningKeyPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
		const invalidAudience = createAudience(nacl.box.keyPair().publicKey, invalidAudienceSigningKeyPair);

		const res = await request(app)
			.post("/session/public-key")
			.send(
				sessionBody(
					session,
					contentEncryptionKeyPair.secretKey,
					invalidAudience,
				),
			)
			.expect(400);

		expect(res.body).toEqual({
			error: "Invalid audience (wrong signature, wrong chain, etc.)",
		});
	});
});
