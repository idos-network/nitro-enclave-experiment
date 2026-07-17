import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { decrypt } from "../providers/encryption.ts";
import { app, resetMocks } from "./app.ts";
import { b64 } from "./helpers.ts";

describe("POST /encrypt", () => {
  beforeEach(resetMocks);

  it("encrypts for a recipient", async () => {
    const recipientKeyPair = nacl.box.keyPair();
    const plaintext = b64(Buffer.from("encrypt me"));

    const res = await request(app)
      .post("/encrypt")
      .send({
        arguments: {
          payload: plaintext,
          publicKey: b64(recipientKeyPair.publicKey),
        },
      })
      .expect(200);

    const recovered = decrypt(
      res.body.encrypted,
      res.body.nonce,
      res.body.publicKey,
      recipientKeyPair.secretKey,
    );

    expect(recovered).toBe(plaintext);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request(app).post("/encrypt").send({ sessionId: "not-a-uuid" }).expect(400);

    expect(res.body.error).toBe("Invalid request body");
    expect(res.body.details).toBeDefined();
  });
});
