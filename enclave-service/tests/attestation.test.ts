import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNING_PUBLIC_KEY_DER } from "../providers/signing.ts";
import { app, resetMocks } from "./app.ts";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

type Callback = (error: Error | null, stdout?: Buffer) => void;

describe("GET /attestation", () => {
  beforeEach(resetMocks);

  it("returns the NSM document over the nonce and the signing key", async () => {
    const document = Buffer.from("cose-sign1");
    execFile.mockImplementation((_cmd, _args, _opts, cb: Callback) => cb(null, document));
    const nonce = Buffer.from("0123456789abcdef0123456789abcdef");

    const res = await request(app)
      .get("/attestation")
      .query({ nonce: nonce.toString("base64url") })
      .expect(200);

    expect(res.body).toEqual({ attestation: document.toString("base64") });
    expect(execFile).toHaveBeenCalledWith(
      "nsm-attest",
      [nonce.toString("hex"), SIGNING_PUBLIC_KEY_DER.toString("hex")],
      { encoding: "buffer" },
      expect.any(Function),
    );
  });

  it("works without a nonce", async () => {
    execFile.mockImplementation((_cmd, _args, _opts, cb: Callback) => cb(null, Buffer.alloc(1)));

    await request(app).get("/attestation").expect(200);
    expect(execFile.mock.calls[0]?.[1][0]).toBe("");
  });

  it("rejects a nonce over 64 bytes or not base64url", async () => {
    await request(app)
      .get("/attestation")
      .query({ nonce: "a".repeat(87) })
      .expect(400);
    await request(app).get("/attestation").query({ nonce: "not base64url!" }).expect(400);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("fails closed without the NSM", async () => {
    execFile.mockImplementation((_cmd, _args, _opts, cb: Callback) => cb(new Error("ENOENT")));

    await request(app).get("/attestation").expect(500);
  });
});
