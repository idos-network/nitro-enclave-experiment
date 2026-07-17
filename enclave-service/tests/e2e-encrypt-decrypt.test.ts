import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { app, createSession, resetMocks } from "./app.ts";
import { audience, b64, decryptAudienceResponse, sessionBody } from "./helpers.ts";

describe("e2e: session → encrypt → decrypt", () => {
  beforeEach(resetMocks);

  it("round-trips plaintext through HTTP encrypt then decrypt", async () => {
    const sessionRecipient = await createSession();

    const recipientKeyPair = nacl.box.keyPair();

    const plaintext = b64(Buffer.from("e2e roundtrip payload"));

    const encrypted = await request(app)
      .post("/encrypt")
      .send({
        arguments: {
          payload: plaintext,
          // Encrypt for the recipient
          publicKey: b64(recipientKeyPair.publicKey),
        },
      })
      .expect(200);

    expect(encrypted.body).toEqual({
      encrypted: expect.any(String),
      nonce: expect.any(String),
      publicKey: expect.any(String),
    });

    const decrypted = await request(app)
      .post("/session/decrypt")
      .send(
        sessionBody(sessionRecipient, recipientKeyPair.secretKey, audience, {
          payload: encrypted.body.encrypted,
          nonce: encrypted.body.nonce,
          publicKey: encrypted.body.publicKey,
        }),
      )
      .expect(200);

    const decryptedPayload = decryptAudienceResponse(decrypted.body);
    expect(decryptedPayload.data).toBe(plaintext);
  });
});
