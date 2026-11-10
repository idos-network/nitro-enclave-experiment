import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNING_PUBLIC_KEY_DER } from "../providers/signing.ts";
import { app, resetMocks } from "./app.ts";

// The real one needs the Rust addon and /dev/nsm, i.e. a running enclave
const getAttestationDocument = vi.hoisted(() => vi.fn());
vi.mock("@idos/nitro-nsm/index.ts", () => ({ getAttestationDocument }));

describe("GET /attestation", () => {
  beforeEach(resetMocks);

  it("returns the NSM document over the nonce and the signing key", async () => {
    const document = Buffer.from("cose-sign1");
    getAttestationDocument.mockReturnValue(document);
    const nonce = Buffer.from("0123456789abcdef0123456789abcdef");

    const res = await request(app)
      .get("/attestation")
      .query({ nonce: nonce.toString("base64url") })
      .expect(200);

    expect(res.body).toEqual({ attestation: document.toString("base64") });
    expect(getAttestationDocument).toHaveBeenCalledExactlyOnceWith({
      nonce,
      publicKey: SIGNING_PUBLIC_KEY_DER,
    });
  });

  it("works without a nonce", async () => {
    getAttestationDocument.mockReturnValue(Buffer.alloc(1));

    await request(app).get("/attestation").expect(200);
    expect(getAttestationDocument.mock.calls[0]?.[0].nonce).toHaveLength(0);
  });

  it("rejects a nonce over 64 bytes or not base64url", async () => {
    await request(app)
      .get("/attestation")
      .query({ nonce: "a".repeat(87) })
      .expect(400);
    await request(app).get("/attestation").query({ nonce: "not base64url!" }).expect(400);
    expect(getAttestationDocument).not.toHaveBeenCalled();
  });

  it("fails closed without the NSM", async () => {
    getAttestationDocument.mockImplementation(() => {
      throw new Error("cannot open /dev/nsm");
    });

    await request(app).get("/attestation").expect(500);
  });
});
