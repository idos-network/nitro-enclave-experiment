import { importJWK, jwtVerify } from "jose";
import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { app, createSession, resetMocks, sessions, sign, storeSession } from "./app.ts";
import { AUDIENCE_ROOT, b64, SIGNING_KEY_PAIR, SIGNING_KID } from "./helpers.ts";

const validBody = () => ({
  sessionClientPublicKey: b64(nacl.box.keyPair().publicKey),
  allowedAudienceRoots: [AUDIENCE_ROOT],
});

describe("POST /session", () => {
  beforeEach(resetMocks);

  it("stores key in mocked mongo and signs via mocked KMS", async () => {
    const session = await createSession();

    const publicKey = Buffer.from(session.sessionClientKeyPair.publicKey).toString("base64url");

    // Check if mocked KMS signer was called
    expect(sign()).toHaveBeenCalledOnce();
    expect(storeSession()).toHaveBeenCalledOnce();
    expect(storeSession().mock.calls[0]?.[0]).toBe(session.id);
    expect(storeSession().mock.calls[0]?.[2]).toBe(publicKey);
    expect(sessions().get(session.id)?.sessionClientPublicKeyB64).toBe(publicKey);

    const { sessionServerPublicKey, jwtChain } = session.response;

    expect(sessionServerPublicKey).toEqual({
      kty: "OKP",
      crv: "X25519",
      x: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    });

    const signingPublicKey = await importJWK(
      SIGNING_KEY_PAIR.publicKey.export({ format: "jwk" }),
      "EdDSA",
    );
    const decoded = await jwtVerify(jwtChain, signingPublicKey, {
      algorithms: ["EdDSA"],
    });

    expect(decoded?.payload).toEqual({
      sessionServerPublicKeyX: sessionServerPublicKey.x,
      nonce: expect.any(String),
    });

    expect(decoded?.protectedHeader).toEqual({
      kid: SIGNING_KID.split("/")[1], // just the key ID, not the full ARN
      alg: "EdDSA",
      iss: "https://test.root.com",
      jku: "https://test.root.com/.well-known/jwks.json",
    });
  });

  it("rejects a missing session token", async () => {
    await request(app).post("/session").send(validBody()).expect(401);
    expect(storeSession()).not.toHaveBeenCalled();
  });

  it("rejects an unknown session token", async () => {
    await request(app)
      .post("/session")
      .set("Authorization", "Bearer not-a-session-token")
      .send(validBody())
      .expect(401);
    expect(storeSession()).not.toHaveBeenCalled();
  });

  it("accepts any token from SESSION_TOKENS", async () => {
    await request(app)
      .post("/session")
      .set("Authorization", "Bearer session-token-two")
      .send(validBody())
      .expect(200);
  });

  it("rejects more than 10 audience roots", async () => {
    await request(app)
      .post("/session")
      .set("Authorization", "Bearer session-token-one")
      .send({
        sessionClientPublicKey: b64(nacl.box.keyPair().publicKey),
        allowedAudienceRoots: Array(11).fill(AUDIENCE_ROOT),
      })
      .expect(400);
    expect(storeSession()).not.toHaveBeenCalled();
  });

  it("rejects bodies above 16kb with 413", async () => {
    await request(app)
      .post("/session")
      .send({ sessionClientPublicKey: "x".repeat(17 * 1024), allowedAudienceRoots: [] })
      .expect(413);
    expect(storeSession()).not.toHaveBeenCalled();
  });

  it("returns a unique session each call", async () => {
    const a = await createSession();
    const b = await createSession();

    expect(a.id).not.toBe(b.id);
    expect(sessions().size).toBe(2);
  });
});
