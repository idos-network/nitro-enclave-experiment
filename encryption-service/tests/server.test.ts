import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "../providers/encryption.ts";
import { b64, sessionBody } from "./helpers.ts";

const SIGNING_KID = "arn:aws:kms:eu-central-1:000000000000:key/signing-test";

const { storeSession, getSession, sessions } = vi.hoisted(() => {
	const sessions = new Map<string, Uint8Array>();

	return {
		sessions,
		storeSession: vi.fn(
			async (sessionId: string, encryptionPrivateKey: Uint8Array) => {
				sessions.set(sessionId, Uint8Array.from(encryptionPrivateKey));
			},
		),
		getSession: vi.fn(async (sessionId: string) => {
			const encryptionPrivateKey = sessions.get(sessionId);
			if (!encryptionPrivateKey) return null;
			return { sessionId, encryptionPrivateKey };
		}),
	};
});

const { sign, getPublicKeyJWK } = vi.hoisted(() => ({
	sign: vi.fn(async () => "mock-kms-signature"),
	getPublicKeyJWK: vi.fn(async () => ({
		kty: "OKP",
		crv: "Ed25519",
		x: "test-public-key",
		kid: SIGNING_KID,
		use: "sig",
		alg: "EdDSA",
	})),
}));

vi.mock("../providers/db.ts", () => ({
	storeSession,
	getSession,
	connectDB: vi.fn(),
}));

vi.mock("../providers/kms.ts", () => ({
	sign,
	getPublicKeyJWK,
}));

const { default: app } = await import("../server.ts");

async function createSession() {
	const res = await request(app).post("/session").expect(200);
	return res.body as {
		sessionId: string;
		signature: string;
		kid: string;
		payload: {
			encryptionPublicKey: string;
			algorithm: string;
			timestamp: string;
			nonce: string;
		};
	};
}

describe("encryption service HTTP", () => {
	beforeEach(() => {
		sessions.clear();
		vi.clearAllMocks();
	});

	it("GET / and /health", async () => {
		await request(app)
			.get("/")
			.expect(200)
			.expect({ message: "Encryption Service is running" });

		await request(app).get("/health").expect(200).expect({ status: "ok" });
	});

	it("GET /.well-known/jwks.json uses mocked KMS", async () => {
		const res = await request(app).get("/.well-known/jwks.json").expect(200);

		expect(getPublicKeyJWK).toHaveBeenCalledOnce();
		expect(res.body).toEqual({
			keys: [
				{
					kty: "OKP",
					crv: "Ed25519",
					x: "test-public-key",
					kid: SIGNING_KID,
					use: "sig",
					alg: "EdDSA",
				},
			],
		});
	});

	it("POST /session stores key in mocked mongo and signs via mocked KMS", async () => {
		const body = await createSession();

		expect(sign).toHaveBeenCalledOnce();
		expect(storeSession).toHaveBeenCalledOnce();
		expect(storeSession.mock.calls[0]?.[0]).toBe(body.sessionId);
		expect(sessions.has(body.sessionId)).toBe(true);

		const expectedPayload =
			body.payload.encryptionPublicKey +
			body.payload.algorithm +
			body.payload.timestamp +
			body.payload.nonce;
		expect(Buffer.from(sign.mock.calls[0]?.[0] as Uint8Array).toString()).toBe(
			expectedPayload,
		);

		expect(body.signature).toBe("mock-kms-signature");
		expect(body.kid).toBe(SIGNING_KID);
		expect(body.payload.algorithm).toBe("curve25519xsalsa20poly1305");
		expect(body.payload.encryptionPublicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
	});

	it("POST /session/public-key returns the unwrapped user public key", async () => {
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

		expect(getSession).toHaveBeenCalledWith(session.sessionId);
		expect(res.body).toEqual({
			sessionId: session.sessionId,
			publicKey: b64(user.publicKey),
		});
	});

	it("POST /session/encrypt encrypts for a recipient", async () => {
		const session = await createSession();
		const sender = nacl.box.keyPair();
		const recipient = nacl.box.keyPair();
		const plaintext = b64(Buffer.from("encrypt me"));

		const res = await request(app)
			.post("/session/encrypt")
			.send(
				sessionBody(
					session.sessionId,
					session.payload.encryptionPublicKey,
					sender,
					{ data: plaintext, publicKey: b64(recipient.publicKey) },
				),
			)
			.expect(200);

		const recovered = decrypt(recipient, b64(sender.publicKey), res.body.data);
		expect(recovered).toBe(plaintext);
	});

	it("POST /session/decrypt decrypts a sender ciphertext", async () => {
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

	it("returns 400 for invalid session request body", async () => {
		const res = await request(app)
			.post("/session/encrypt")
			.send({ sessionId: "not-a-uuid" })
			.expect(400);

		expect(res.body.error).toBe("Invalid request body");
		expect(res.body.details).toBeDefined();
	});

	it("returns 404 when session is missing from mocked mongo", async () => {
		const user = nacl.box.keyPair();
		const missingSessionId = crypto.randomUUID();

		const res = await request(app)
			.post("/session/public-key")
			.send(
				sessionBody(missingSessionId, b64(nacl.box.keyPair().publicKey), user),
			)
			.expect(404);

		expect(res.body).toEqual({ error: "Session not found" });
		expect(getSession).toHaveBeenCalledWith(missingSessionId);
	});

	it("returns 404 when wrappedUserKey cannot be unwrapped", async () => {
		const session = await createSession();
		const user = nacl.box.keyPair();
		// Wrap to a different session pubkey so unwrap with stored secret fails
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
