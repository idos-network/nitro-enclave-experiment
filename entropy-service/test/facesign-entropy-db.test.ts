import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const docs = new Map<string, { faceSignUserId: string; entropy: unknown }>();
  const usedTokens = new Set<string>();
  const keys: { keyAltNames: string[] }[] = [];

  return {
    docs,
    usedTokens,
    // Set to make the next findOneAndUpdate throw. `insert`, when given, is
    // written first, standing in for the racing writer that caused the clash.
    nextUpsertThrows: null as { error: Error; insert?: unknown } | null,
    createIndex: vi.fn(async () => {}),
    keyVault: {
      createIndex: async () => {},
      findOne: async ({ keyAltNames }: { keyAltNames: string }) =>
        keys.find((key) => key.keyAltNames.includes(keyAltNames)) ?? null,
      insertOne: async (key: { keyAltNames: string[] }) => {
        keys.push(key);
      },
      updateOne: async () => {},
    },
  };
});

// Stand-in for KMS: the "ciphertext" of a data key is the data key
vi.mock("@aws-sdk/client-kms", () => ({
  KMSClient: class {
    send = async (command: { input: { Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array } }) => ({
      CiphertextBlob: command.input.Plaintext,
      Plaintext: command.input.CiphertextBlob,
    });
  },
  EncryptCommand: class {
    constructor(readonly input: object) {}
  },
  DecryptCommand: class {
    constructor(readonly input: object) {}
  },
}));

vi.mock("mongodb", async (importOriginal) => {
  const { Binary } = await importOriginal<typeof import("mongodb")>();

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
          return { collection: () => h.keyVault };
        }

        return {
          collection: () => ({
            createIndex: h.createIndex,
            // Stands in for the _id unique index: a second insert of the same
            // jti fails with E11000, as real Mongo would.
            insertOne: async ({ _id }: { _id: string }) => {
              if (h.usedTokens.has(_id)) {
                throw new MongoServerError("E11000 duplicate key error", 11000);
              }
              h.usedTokens.add(_id);
            },
            deleteOne: async ({ _id }: { _id: string }) => {
              h.usedTokens.delete(_id);
            },
            findOne: async ({ faceSignUserId }: { faceSignUserId: string }) =>
              h.docs.get(faceSignUserId) ?? null,
            findOneAndUpdate: async (
              { faceSignUserId }: { faceSignUserId: string },
              update: { $setOnInsert: { entropy: unknown } },
            ) => {
              const failure = h.nextUpsertThrows;
              if (failure) {
                h.nextUpsertThrows = null;

                if (failure.insert) {
                  h.docs.set(faceSignUserId, { faceSignUserId, entropy: failure.insert });
                }

                throw failure.error;
              }

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
  };
});

const mongodb = await import("mongodb");
const { Binary } = mongodb;
// The mock takes (message, code); the real signature is (ErrorDescription).
const MongoServerError = mongodb.MongoServerError as unknown as new (
  message: string,
  code: number,
) => Error & { code: number };

const { connectDB, consumeTokenId, fetchOrCreateFaceSignEntropy, releaseTokenId } = await import(
  "../providers/db.ts"
);

describe("consumeTokenId", () => {
  // Must run before any other consumeTokenId call, while the index promise is unset.
  it("retries index creation after a failed attempt", async () => {
    h.createIndex.mockRejectedValueOnce(new Error("index failed"));

    await expect(consumeTokenId("index-retry")).rejects.toThrow("index failed");
    await expect(consumeTokenId("index-retry")).resolves.toBe(true);
  });

  it("lets exactly one of two concurrent redemptions win", async () => {
    const results = await Promise.all([consumeTokenId("race-jti"), consumeTokenId("race-jti")]);

    expect(results.sort()).toEqual([false, true]);
  });

  it("allows a released token to be consumed again", async () => {
    expect(await consumeTokenId("released-jti")).toBe(true);
    await releaseTokenId("released-jti");
    expect(await consumeTokenId("released-jti")).toBe(true);
  });
});

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
    const { decrypt } = await connectDB();
    expect(await decrypt(h.docs.get(userId)?.entropy)).toBe(a.entropy);
  });

  // Against real Mongo the racing insert lands between our findOne and the
  // upsert, so the unique index rejects us with E11000 instead of returning a
  // document. The mock above cannot race for real, so drive that branch here.
  it("returns the stored entropy when the upsert loses on a duplicate key", async () => {
    const userId = "duplicate-key-user";
    const winner = "winner mnemonic";
    const { encrypt, decrypt } = await connectDB();

    h.nextUpsertThrows = {
      error: new MongoServerError("E11000 duplicate key error", 11000),
      insert: await encrypt(winner),
    };

    const result = await fetchOrCreateFaceSignEntropy(userId);

    expect(result).toEqual({ insert: false, entropy: winner });
    expect(await decrypt(h.docs.get(userId)?.entropy)).toBe(winner);
  });

  it("rethrows an upsert failure that is not a duplicate key", async () => {
    h.nextUpsertThrows = { error: new MongoServerError("connection reset", 6) };

    await expect(fetchOrCreateFaceSignEntropy("rethrow-user")).rejects.toThrow("connection reset");
    expect(h.docs.has("rethrow-user")).toBe(false);
  });
});

describe("decrypt", () => {
  // The stored shape depends on how the document round-tripped through the
  // driver, so decrypt() has to take all of them.
  it.each([
    ["Binary", (ciphertext: Buffer) => new Binary(ciphertext, 6)],
    ["Buffer", (ciphertext: Buffer) => ciphertext],
    ["base64 string", (ciphertext: Buffer) => ciphertext.toString("base64")],
    [
      "extended JSON",
      (ciphertext: Buffer) => ({
        $binary: { base64: ciphertext.toString("base64"), subType: "06" },
      }),
    ],
    ["serialized Binary", (ciphertext: Buffer) => ({ type: 6, data: [...ciphertext] })],
  ])("accepts %s", async (_shape, build) => {
    const { encrypt, decrypt } = await connectDB();
    const ciphertext = Buffer.from((await encrypt("plaintext")).buffer);

    expect((await decrypt<Buffer>(build(ciphertext))).toString()).toBe("plaintext");
  });

  it("rejects a shape it cannot read", async () => {
    const { decrypt } = await connectDB();

    await expect(decrypt({ nope: true })).rejects.toThrow("Invalid encrypted payload format");
  });
});
