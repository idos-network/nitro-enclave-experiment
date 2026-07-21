import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { app, createSession, getSession, resetMocks } from "./app.ts";
import { b64, sessionBody } from "./helpers.ts";

describe("POST /session/public-key", () => {
	beforeEach(resetMocks);

	it("returns the unwrapped user public key", async () => {
		const session = await createSession();
		const user = nacl.box.keyPair();

		const res = await request(app)
			.post("/session/public-key")
			.send(
				sessionBody(
					session.sessionId,
					session.payload.encryptionPublicKey,
					user,
				),
			)
			.expect(200);

		expect(getSession()).toHaveBeenCalledWith(session.sessionId);
		expect(res.body).toEqual({
			sessionId: session.sessionId,
			publicKey: b64(user.publicKey),
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
		const user = nacl.box.keyPair();
		const missingSessionId = crypto.randomUUID();

		const res = await request(app)
			.post("/session/public-key")
			.send(
				sessionBody(missingSessionId, b64(nacl.box.keyPair().publicKey), user),
			)
			.expect(404);

		expect(res.body).toEqual({ error: "Session not found" });
		expect(getSession()).toHaveBeenCalledWith(missingSessionId);
	});

	it("returns 404 when wrappedUserKey cannot be unwrapped", async () => {
		const session = await createSession();
		const user = nacl.box.keyPair();
		const body = sessionBody(
			session.sessionId,
			b64(nacl.box.keyPair().publicKey),
			user,
		);

		const res = await request(app)
			.post("/session/public-key")
			.send(body)
			.expect(404);

		expect(res.body).toEqual({ error: "Session not found" });
	});
});
