import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  clientEncryptionCtor: vi.fn(),
  getKeyByAltName: vi.fn(async () => ({ _id: "data-key-id", masterKey: { provider: "local" } })),
  rewrapManyDataKey: vi.fn(async () => ({ bulkWriteResult: { modifiedCount: 1 } })),
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
    rewrapManyDataKey = h.rewrapManyDataKey;
    createDataKey = async () => "data-key-id";
    encrypt = async () => "enc";
    decrypt = async () => "dec";
  },
}));

type Options = { kmsProviders: Record<string, unknown>; credentialProviders?: { aws?: unknown } };

// Fresh module per test: db.ts memoizes the ClientEncryption and the data key id.
async function importDb() {
  vi.resetModules();
  return import("../providers/db.ts");
}

describe("CSFLE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Each `new ClientEncryption` allocates its own libmongocrypt handle with an
  // empty data-key cache, so rebuilding it per request unwraps the DEK on every
  // encrypt/decrypt.
  it("reuses one ClientEncryption and resolves the data key once across concurrent requests", async () => {
    const { connectDB } = await importDb();
    await Promise.all(Array.from({ length: 50 }, () => connectDB()));

    expect(h.clientEncryptionCtor).toHaveBeenCalledTimes(1);
    expect(h.getKeyByAltName).toHaveBeenCalledTimes(1);
    expect(h.listCollections).toHaveBeenCalledTimes(1);
  });

  it("wraps data keys with the local master key only, never the host-callable aws provider", async () => {
    const { connectDB } = await importDb();
    await connectDB();

    const options = h.clientEncryptionCtor.mock.calls[0]?.[1] as Options;

    expect(options.kmsProviders).toEqual({ local: { key: Buffer.alloc(96) } });
    expect(options.credentialProviders).toBeUndefined();
    expect(h.rewrapManyDataKey).not.toHaveBeenCalled();
  });

  it("rewraps aws-wrapped data keys to local once, using the host role for the old key", async () => {
    h.getKeyByAltName.mockResolvedValueOnce({ _id: "data-key-id", masterKey: { provider: "aws" } });

    const { connectDB } = await importDb();
    await connectDB();

    expect(h.rewrapManyDataKey).toHaveBeenCalledExactlyOnceWith(
      { "masterKey.provider": "aws" },
      { provider: "local" },
    );

    const rewrapOptions = h.clientEncryptionCtor.mock.calls[1]?.[1] as Options;
    expect(rewrapOptions.kmsProviders).toEqual({ aws: {}, local: { key: Buffer.alloc(96) } });
    expect(rewrapOptions.credentialProviders?.aws).toBe(h.credentialsProvider);
  });
});
