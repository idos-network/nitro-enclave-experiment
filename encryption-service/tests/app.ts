import request from "supertest";
import { vi } from "vitest";

export const SIGNING_KID =
	"arn:aws:kms:eu-central-1:000000000000:key/signing-test";

const mocks = vi.hoisted(() => {
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
		sign: vi.fn(async (_payload: Uint8Array) => "mock-kms-signature"),
		getPublicKeyJWK: vi.fn(async () => ({
			kty: "OKP",
			crv: "Ed25519",
			x: "test-public-key",
			kid: "arn:aws:kms:eu-central-1:000000000000:key/signing-test",
			use: "sig",
			alg: "EdDSA",
		})),
	};
});

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

export { app };

export type SessionResponse = {
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

export async function createSession(): Promise<SessionResponse> {
	const res = await request(app).post("/session").expect(200);
	return res.body as SessionResponse;
}

export function resetMocks() {
	mocks.sessions.clear();
	vi.clearAllMocks();
}

/** Accessors — vitest forbids exporting `vi.hoisted` bindings directly. */
export const storeSession = () => mocks.storeSession;
export const getSession = () => mocks.getSession;
export const sessions = () => mocks.sessions;
export const sign = () => mocks.sign;
export const getPublicKeyJWK = () => mocks.getPublicKeyJWK;
