import { describe, expect, it, vi } from "vitest";
import { armBody } from "./helpers.ts";

// In-memory Mongo with the real FLE (tee-common/fle-crypto.ts) on top, so a test can tell
// encrypted fields from plaintext ones and swap blobs between records.
const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const keys: { keyAltNames: string[] }[] = [];
  return {
    docs,
    keyVault: {
      createIndex: async () => {},
      findOne: async ({ keyAltNames }: { keyAltNames: string }) =>
        keys.find((key) => key.keyAltNames.includes(keyAltNames)) ?? null,
      insertOne: async (key: { keyAltNames: string[] }) => {
        keys.push(key);
      },
      updateOne: async () => {},
    },
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

vi.mock("mongodb", async (importOriginal) => ({
  Binary: (await importOriginal<typeof import("mongodb")>()).Binary,
  MongoClient: class {
    connect = async () => {};
    db = () => ({
      collection: (name: string) => (name === "__keyVault" ? h.keyVault : h.collection),
    });
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
    expect(JSON.stringify(plaintext)).not.toContain("iron-secret");
  });

  it("round-trips the armed record", async () => {
    await storeArmed("id-2", armBody());

    const armed = await getArmed("id-2");
    expect(armed).toEqual({ id: "id-2", ...armBody() });
  });

  it("rejects a blob copied from another record", async () => {
    await storeArmed("victim", armBody());
    await storeArmed("attacker", armBody({ environment: "production" }));

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
