import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const docs = new Map<string, { faceSignUserId: string; entropy: Buffer }>();

  return {
    docs,
    createIndex: vi.fn(async () => {}),
    listCollections: vi.fn(() => ({ toArray: async () => [{ name: "__keyVault" }] })),
    credentialsProvider: vi.fn(async () => ({
      accessKeyId: "a",
      secretAccessKey: "b",
      sessionToken: "c",
    })),
  };
});

vi.mock("@aws-sdk/credential-provider-node", () => ({
  defaultProvider: () => h.credentialsProvider,
}));

vi.mock("mongodb", () => {
  class Binary {
    buffer: Buffer;
    sub_type: number;
    constructor(buf: Buffer, subType: number) {
      this.buffer = buf;
      this.sub_type = subType;
    }
  }

  class MongoServerError extends Error {
    code: number;
    constructor(message: string, code: number) {
      super(message);
      this.code = code;
    }
  }

  return {
    Binary,
    MongoServerError,
    MongoClient: class {
      connect = async () => {};
      db = (name: string) => {
        if (name === "encryption") {
          return {
            listCollections: h.listCollections,
            createCollection: async () => {},
            collection: () => ({ createIndex: async () => {} }),
          };
        }

        return {
          collection: () => ({
            createIndex: h.createIndex,
            findOne: async ({ faceSignUserId }: { faceSignUserId: string }) =>
              h.docs.get(faceSignUserId) ?? null,
            findOneAndUpdate: async (
              { faceSignUserId }: { faceSignUserId: string },
              update: { $setOnInsert: { entropy: Buffer } },
            ) => {
              const existing = h.docs.get(faceSignUserId);
              if (existing) {
                return existing;
              }

              const doc = { faceSignUserId, entropy: update.$setOnInsert.entropy };
              h.docs.set(faceSignUserId, doc);
              return doc;
            },
          }),
        };
      };
    },
    ClientEncryption: class {
      getKeyByAltName = async () => ({ _id: "data-key-id" });
      createDataKey = async () => "data-key-id";
      encrypt = async (value: string) => Buffer.from(value);
      decrypt = async (value: { buffer: Buffer }) => value.buffer;
    },
  };
});

const { Binary } = await import("mongodb");
const { connectDB, fetchOrCreateFaceSignEntropy } = await import("../providers/db.ts");

describe("fetchOrCreateFaceSignEntropy", () => {
  it("creates a unique index on faceSignUserId", async () => {
    await fetchOrCreateFaceSignEntropy("index-user");

    expect(h.createIndex).toHaveBeenCalledWith({ faceSignUserId: 1 }, { unique: true });
  });

  it("returns the persisted mnemonic when two first-writes race", async () => {
    const userId = "race-user";

    const [a, b] = await Promise.all([
      fetchOrCreateFaceSignEntropy(userId),
      fetchOrCreateFaceSignEntropy(userId),
    ]);

    expect(a.entropy).toBe(b.entropy);
    expect([a.insert, b.insert].filter(Boolean)).toHaveLength(1);
    expect(h.docs.get(userId)?.entropy.toString()).toBe(a.entropy);
  });
});

describe("decrypt", () => {
  const ciphertext = Buffer.from("ciphertext");

  // The stored shape depends on how the document round-tripped through the
  // driver, so decrypt() has to take all of them.
  it.each([
    ["Binary", () => new Binary(ciphertext, 6)],
    ["Buffer", () => ciphertext],
    ["base64 string", () => ciphertext.toString("base64")],
    [
      "extended JSON",
      () => ({ $binary: { base64: ciphertext.toString("base64"), subType: "06" } }),
    ],
  ])("accepts %s", async (_shape, build) => {
    const { decrypt } = await connectDB();

    expect((await decrypt<Buffer>(build())).toString()).toBe("ciphertext");
  });

  it("rejects a shape it cannot read", async () => {
    const { decrypt } = await connectDB();

    await expect(decrypt({ nope: true })).rejects.toThrow("Invalid entropy format");
  });
});
