import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { app, createSession, resetMocks } from "./app.ts";
import { audience, b64, decryptAudienceResponse, sessionBody } from "./helpers.ts";

describe("POST /session/decrypt", () => {
  beforeEach(resetMocks);

  it("decrypts a sender ciphertext", async () => {
    const session = await createSession();
    const contentEncryptionKeyPair = nacl.box.keyPair();
    const recipientKeyPair = nacl.box.keyPair();
    const plaintext = b64(Buffer.from("decrypt me"));

    // We have to encrypt manually (because of ephemeral key pair)
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const encrypted = nacl.box(
      Buffer.from(plaintext, "base64url"),
      nonce,
      recipientKeyPair.publicKey,
      contentEncryptionKeyPair.secretKey,
    );

    if (encrypted === null) {
      throw new Error("Failed to encrypt");
    }

    const res = await request(app)
      .post("/session/decrypt")
      .send(
        sessionBody(session, contentEncryptionKeyPair.secretKey, audience, {
          payload: b64(encrypted),
          nonce: b64(nonce),
          publicKey: b64(recipientKeyPair.publicKey),
        }),
      )
      .expect(200);

    const decryptedPayload = decryptAudienceResponse(res.body);

    expect(decryptedPayload.data).toBe(plaintext);
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
        sessionBody(session, recipient.secretKey, audience, {
          payload: b64(Buffer.from("unused")),
          publicKey: b64(recipient.publicKey),
        }),
      )
      .expect(404);

    expect(res.body).toEqual({ error: "Session not found" });
  });
});
