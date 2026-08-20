import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { splitPayload } from "../utils/payload.ts";

describe("splitPayload", () => {
  it("rejects combined payloads shorter than the nonce length", () => {
    const short = Buffer.alloc(nacl.box.nonceLength - 1).toString("base64url");
    expect(() => splitPayload(short)).toThrow(/Payload too short/);
  });

  it("splits a combined payload into nonce and ciphertext", () => {
    const nonce = Buffer.alloc(nacl.box.nonceLength, 1);
    const encrypted = Buffer.from([2, 3, 4]);
    const combined = Buffer.concat([nonce, encrypted]).toString("base64url");

    expect(splitPayload(combined)).toEqual([
      encrypted.toString("base64url"),
      nonce.toString("base64url"),
    ]);
  });
});
