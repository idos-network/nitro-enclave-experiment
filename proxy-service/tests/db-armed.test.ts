import { describe, expect, it, vi } from "vitest";
import { armBody } from "./helpers.ts";

// In-memory Mongo + a ClientEncryption whose "ciphertext" is a tagged JSON wrapper,
// so a test can tell encrypted fields from plaintext ones and swap blobs between records.
const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    collection: {
      createIndex: async () => {},
      insertOne: async (doc: Record<string, unknown>) => {
        docs.set(doc.armedId as string, doc);
      },
      findOne: async ({ armedId }: { armedId: string }) => docs.get(armedId) ?? null,
      deleteOne: async ({ armedId }: { armedId: string }) => ({
        deletedCount: docs.delete(armedId) ? 1 : 0,
      }),
    },
  };
});

vi.mock("@aws-sdk/credential-provider-node", () => ({ defaultProvider: () => async () => ({}) }));

vi.mock("mongodb", () => ({
  MongoClient: class {
    connect = async () => {};
    db = () => ({
      listCollections: () => ({ toArray: async () => [{ name: "__keyVault" }] }),
      createCollection: async () => {},
      collection: () => h.collection,
    });
  },
  ClientEncryption: class {
    getKeyByAltName = async () => ({ _id: "data-key-id" });
    createDataKey = async () => "data-key-id";
    encrypt = async (value: string) => ({ enc: value });
    decrypt = async (value: { enc: string }) => value.enc;
  },
}));

const { deleteArmed, getArmed, storeArmed } = await import("../providers/db.ts");

describe("armed records in Mongo", () => {
  it("stores everything but the id as one encrypted blob", async () => {
    await storeArmed("id-1", armBody());

    const doc = h.docs.get("id-1");
    expect(doc).toBeDefined();
    const { dataEnc, ...plaintext } = doc ?? {};
    expect(dataEnc).toBeDefined();
    expect(Object.keys(plaintext).sort()).toEqual(["armedId", "createdAt"]);
    expect(JSON.stringify(plaintext)).not.toContain(armBody().baseUrl);
    expect(JSON.stringify(plaintext)).not.toContain("iron-secret");
  });

  it("round-trips the armed record", async () => {
    await storeArmed("id-2", armBody());

    const armed = await getArmed("id-2");
    expect(armed).toEqual({ id: "id-2", ...armBody() });
  });

  it("rejects a blob copied from another record", async () => {
    await storeArmed("victim", armBody());
    await storeArmed("attacker", armBody({ baseUrl: "https://evil.example.com" }));

    const victim = h.docs.get("victim");
    const attacker = h.docs.get("attacker");
    if (!victim || !attacker) throw new Error("records missing");
    attacker.dataEnc = victim.dataEnc;

    await expect(getArmed("attacker")).rejects.toThrow(/armedId/);
  });

  it("deletes a record and reports whether it existed", async () => {
    await storeArmed("id-3", armBody());

    expect(await deleteArmed("id-3")).toBe(true);
    expect(await getArmed("id-3")).toBeNull();
    expect(await deleteArmed("id-3")).toBe(false);
  });
});
