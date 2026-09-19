import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  clientEncryptionCtor: vi.fn(),
  getKeyByAltName: vi.fn(async () => ({ _id: "data-key-id" })),
  listCollections: vi.fn(() => ({ toArray: async () => [{ name: "__keyVault" }] })),
  credentialsProvider: vi.fn(async () => ({
    accessKeyId: "a",
    secretAccessKey: "b",
    sessionToken: "c",
  })),
}));

vi.mock("@aws-sdk/credential-provider-node", () => ({
  defaultProvider: () => h.credentialsProvider,
}));

vi.mock("mongodb", () => ({
  MongoClient: class {
    connect = async () => {};
    db = () => ({
      listCollections: h.listCollections,
      createCollection: async () => {},
      collection: () => ({ createIndex: async () => {}, findOne: async () => null }),
    });
  },
  ClientEncryption: class {
    constructor(...args: unknown[]) {
      h.clientEncryptionCtor(...args);
    }
    getKeyByAltName = h.getKeyByAltName;
    createDataKey = async () => "data-key-id";
    encrypt = async () => "enc";
    decrypt = async () => "dec";
  },
}));

const { connectDB } = await import("../providers/db.ts");

describe("CSFLE key cache reuse", () => {
  // Each `new ClientEncryption` allocates its own libmongocrypt handle with an
  // empty data-key cache, so rebuilding it per request forces a KMS round trip
  // on every encrypt/decrypt. Under load that saturates the vsock socat proxy
  // and surfaces as `MongoCryptError: KMS request failed` / ECONNRESET.
  it("reuses one ClientEncryption and resolves the data key once across concurrent requests", async () => {
    await Promise.all(Array.from({ length: 50 }, () => connectDB()));

    expect(h.clientEncryptionCtor).toHaveBeenCalledTimes(1);
    expect(h.getKeyByAltName).toHaveBeenCalledTimes(1);
    expect(h.listCollections).toHaveBeenCalledTimes(1);
  });

  it("uses automatic AWS credential fetching so the instance can outlive its credentials", async () => {
    await connectDB();

    const options = h.clientEncryptionCtor.mock.calls[0]?.[1] as {
      kmsProviders: Record<string, unknown>;
      credentialProviders?: { aws?: unknown };
    };

    // Empty `aws` object opts into driver-side credential fetching + refresh.
    expect(options.kmsProviders).toEqual({ aws: {} });
    expect(options.credentialProviders?.aws).toBe(h.credentialsProvider);
  });
});
