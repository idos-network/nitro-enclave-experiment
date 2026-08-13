import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGNING_KEY_PAIR } from "./helpers.ts";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-kms", () => ({
  KMSClient: class {
    send = send;
  },
  GetPublicKeyCommand: class {
    // empty class for testing
  },
  SignCommand: class {
    // empty class for testing
  },
}));

const { getPublicKeyJWK } = await import("../providers/kms.ts");

const publicKeyDer = SIGNING_KEY_PAIR.publicKey.export({ type: "spki", format: "der" });

describe("getPublicKeyJWK cache", () => {
  afterEach(() => {
    vi.useRealTimers();
    send.mockReset();
  });

  it("calls KMS once within a minute, then again after TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    send.mockResolvedValue({ PublicKey: publicKeyDer });

    await getPublicKeyJWK();
    await getPublicKeyJWK();
    expect(send).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    await getPublicKeyJWK();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
