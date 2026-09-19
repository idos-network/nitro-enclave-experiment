import { describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/credential-provider-node", () => ({
  defaultProvider: () => async () => ({
    accessKeyId: "a",
    secretAccessKey: "b",
    sessionToken: "c",
  }),
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

  return {
    Binary,
    MongoServerError: class extends Error {},
    MongoClient: class {
      connect = async () => {};
      db = () => ({
        listCollections: () => ({ toArray: async () => [{ name: "__keyVault" }] }),
        createCollection: async () => {},
        collection: () => ({ createIndex: async () => {} }),
      });
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
// setup.ts mocks providers/db.ts for the route tests; this file wants the real one
const { connectDB } =
  await vi.importActual<typeof import("../../providers/db.ts")>("../../providers/db.ts");

describe("decrypt", () => {
  const ciphertext = Buffer.from("ciphertext");

  // The stored shape depends on how the document round-tripped through the
  // driver, so decrypt() has to take all of them.
  it.each([
    ["Binary", () => new Binary(ciphertext, 6)],
    ["a BSON Binary that lost its class", () => ({ type: 6, data: [...ciphertext] })],
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

    await expect(decrypt({ nope: true })).rejects.toThrow("Invalid encrypted payload format");
  });
});
