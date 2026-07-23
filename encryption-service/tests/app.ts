import { sign as cryptoSign, generateKeyPairSync } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import nacl from "tweetnacl";
import type { Mock } from "vitest";
import { vi } from "vitest";

export const SIGNING_KID =
	"arn:aws:kms:eu-central-1:000000000000:key/signing-test";

const { publicKey: signingPublicKey, privateKey: signingPrivateKey } =
	generateKeyPairSync("ed25519");

export const signingPublicJwk = {
	...signingPublicKey.export({ format: "jwk" }),
	kid: SIGNING_KID,
	use: "sig",
	alg: "EdDSA",
} as const;

export { signingPublicKey };

const mocks = vi.hoisted(() => {
	const sessions = new Map<
		string,
		{ sessionServerPrivateKey: Uint8Array; sessionClientPublicKey: string }
	>();

	return {
		sessions,
		storeSession: vi.fn(
			async (
				sessionId: string,
				sessionServerPrivateKey: Uint8Array,
				sessionClientPublicKey: string,
			) => {
				sessions.set(sessionId, { sessionServerPrivateKey, sessionClientPublicKey });
			},
		),
		getSession: vi.fn(async (sessionId: string) => {
			const { sessionServerPrivateKey, sessionClientPublicKey } = sessions.get(sessionId) ?? {};
			if (!sessionServerPrivateKey || !sessionClientPublicKey) return null;
			return { sessionId, sessionServerPrivateKey, sessionClientPublicKey };
		}),
		sign: vi.fn(),
		getPublicKeyJWK: vi.fn(),
	};
});

mocks.sign.mockImplementation(async (payload: Uint8Array) =>
	cryptoSign(null, Buffer.from(payload), signingPrivateKey),
);
mocks.getPublicKeyJWK.mockImplementation(async () => ({ ...signingPublicJwk }));

vi.mock("../providers/db.ts", () => ({
	storeSession: mocks.storeSession,
	getSession: mocks.getSession,
	connectDB: vi.fn(),
}));

vi.mock("../providers/kms.ts", () => ({
	sign: mocks.sign,
	getPublicKeyJWK: mocks.getPublicKeyJWK,
}));

const { default: app } = await import("../server.ts");

app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
	if (err) {
		console.error(err);
		res.status(500).json({ error: "Internal server error" });
	} else {
		next();
	}
});

export { app };

export type SessionResponse = {
	id: string;
	sessionServerPublicKey: {
		kty: string;
		crv: string;
		x: string;
	};
	sessionServerPublicKeySignature: {
		protected: string;
		payload: string;
		signature: string;
	};
};

export interface CreateSessionResponse {
	id: string;
	response: SessionResponse;
	sessionServerPublicKey: Uint8Array;
	sessionClientKeyPair: nacl.BoxKeyPair;
}

export async function createSession(): Promise<CreateSessionResponse> {
	const sessionClientKeyPair = nacl.box.keyPair();

	const res = await request(app)
		.post("/session")
		.send({
			sessionClientPublicKey: Buffer.from(
				sessionClientKeyPair.publicKey,
			).toString("base64"),
			allowedAudienceRoots: [],
		})
		.expect(200);

	return {
		response: res.body as SessionResponse,
		id: res.body.id,
		sessionServerPublicKey: Buffer.from(res.body.sessionServerPublicKey.x, "base64"),
		sessionClientKeyPair,
	};
}

export function resetMocks() {
	mocks.sessions.clear();
	vi.clearAllMocks();
}

/** Accessors — vitest forbids exporting `vi.hoisted` bindings directly. */
export const storeSession = () => mocks.storeSession;
export const getSession = () => mocks.getSession;
export const sessions = () => mocks.sessions;
export const sign = (): Mock<(payload: Uint8Array) => Promise<Buffer>> =>
	mocks.sign;
export const getPublicKeyJWK = (): Mock<
	() => Promise<typeof signingPublicJwk>
> => mocks.getPublicKeyJWK;
