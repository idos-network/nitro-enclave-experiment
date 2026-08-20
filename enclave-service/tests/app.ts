import { sign as cryptoSign } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import nacl from "tweetnacl";
import type { Mock } from "vitest";
import { vi } from "vitest";
import {
  AUDIENCE_ROOT,
  AUDIENCE_SIGNING_PUBLIC_KEY_JWK,
  SIGNING_KEY_PAIR,
  SIGNING_PUBLIC_KEY_JWK,
} from "./helpers.ts";

function mockAudienceJwks() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === `https://${AUDIENCE_ROOT}/.well-known/jwks.json`) {
        return new Response(JSON.stringify({ keys: [AUDIENCE_SIGNING_PUBLIC_KEY_JWK] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
}

const mocks = vi.hoisted(() => {
  type StoreSession = typeof import("../providers/db.ts").storeSession;
  type GetSession = typeof import("../providers/db.ts").getSession;

  const sessions = new Map<
    string,
    {
      sessionServerKeyPair: Parameters<StoreSession>[1];
      sessionClientPublicKeyB64: string;
      sessionServerJwtChain: string;
      allowedAudienceRoots: string[];
    }
  >();

  return {
    sessions,
    storeSession: vi.fn<StoreSession>(
      async (
        sessionId,
        sessionServerKeyPair,
        sessionClientPublicKeyB64,
        sessionServerJwtChain,
        allowedAudienceRoots,
      ) => {
        sessions.set(sessionId, {
          sessionServerKeyPair,
          sessionClientPublicKeyB64,
          sessionServerJwtChain,
          allowedAudienceRoots,
        });
      },
    ),
    getSession: vi.fn<GetSession>(async (sessionId) => {
      const stored = sessions.get(sessionId);
      if (!stored) return null;

      return {
        id: sessionId,
        allowedAudienceRoots: stored.allowedAudienceRoots,
        sessionClientPublicKey: Buffer.from(stored.sessionClientPublicKeyB64, "base64url"),
        sessionServerPublicKey: stored.sessionServerKeyPair.publicKey,
        sessionServerPrivateKey: stored.sessionServerKeyPair.secretKey,
        sessionServerJwtChain: stored.sessionServerJwtChain,
      };
    }),
    sign: vi.fn(),
    getPublicKeyJWK: vi.fn(),
  };
});

mocks.sign.mockImplementation(async (payload: Uint8Array) =>
  // Mirrors KMS ED25519_SHA_512 with MessageType RAW.
  cryptoSign(null, Buffer.from(payload), SIGNING_KEY_PAIR.privateKey),
);
mocks.getPublicKeyJWK.mockImplementation(async () => ({
  ...SIGNING_PUBLIC_KEY_JWK,
}));

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
  jwtChain: string;
  sessionServerPublicKey: {
    kty: string;
    crv: string;
    x: string;
  };
};

export interface CreateSessionResponse {
  id: string;
  response: SessionResponse;
  sessionServerPublicKey: Uint8Array;
  sessionClientKeyPair: nacl.BoxKeyPair;
  audienceRoot: string;
}

export async function createSession(): Promise<CreateSessionResponse> {
  const sessionClientKeyPair = nacl.box.keyPair();

  const res = await request(app)
    .post("/session")
    .send({
      sessionClientPublicKey: Buffer.from(sessionClientKeyPair.publicKey).toString("base64url"),
      allowedAudienceRoots: [AUDIENCE_ROOT],
    })
    .expect(200);

  return {
    response: res.body as SessionResponse,
    id: res.body.id,
    sessionServerPublicKey: Buffer.from(res.body.sessionServerPublicKey.x, "base64url"),
    sessionClientKeyPair,
    audienceRoot: AUDIENCE_ROOT,
  };
}

export function resetMocks() {
  mocks.sessions.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mockAudienceJwks();
}

/** Accessors — vitest forbids exporting `vi.hoisted` bindings directly. */
export const storeSession = () => mocks.storeSession;
export const getSession = () => mocks.getSession;
export const sessions = () => mocks.sessions;
export const sign = (): Mock<(payload: Uint8Array) => Promise<Buffer>> => mocks.sign;
export const getPublicKeyJWK = (): Mock<() => Promise<typeof SIGNING_PUBLIC_KEY_JWK>> =>
  mocks.getPublicKeyJWK;
