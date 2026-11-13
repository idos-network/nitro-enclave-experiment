// cspell:ignore héllo
import { createFleCrypto } from "@idos/tee-common/fle-crypto.ts";
import { Binary } from "mongodb";
import { describe, expect, it, vi } from "vitest";

// Written by mongodb-client-encryption 7.2.1 (libmongocrypt) with the `local` provider and
// this master key: the key vault document and two AEAD_AES_256_CBC_HMAC_SHA_512-Random values.
const MASTER_KEY = Buffer.from(Array.from({ length: 96 }, (_, i) => (i * 7) & 0xff));
const LIBMONGOCRYPT = {
  id: "rEenXde/SHGiPyNsiYaHiA==",
  keyMaterial:
    "uarsJLTFBRydFMQv0yeSi5PCyr9IZ88tlIJmyqS2cGmLMhpcZoEQ2MPgwZR/X7ryKTO2P7Ze/ge1vd81l6KRLXI/XHXfD6Mshp0RMp6XAQJz6pUJs63EmQzxCVuFSxGiEi2eBpQKEJj6u4BXdncvZDBlcj0Kt0HU2QMEeDxEIzOncEOaessfb9hqC1mKIlhl10Xigq2148tqVyncUTOdEg==",
  string:
    "AqxHp13Xv0hxoj8jbImGh4gCkUvE4BxZ9lKT7IU4Hm3q2ypJT+tMwaKPs1de6iJWY1UuwSmodyie76M5+tS43A5muRIXbKAAv0zZzZV0Z//U7A==",
  binary:
    "AqxHp13Xv0hxoj8jbImGh4gFQeVrTKMtWG2ch9cH1lbkUTd1Ts+zv0m4l0vp29JsFfEtTQo4mHHH9lZqbzroB0VkGhat3ejBLX3ReoFnvvFjMQ==",
};

type KeyDoc = {
  _id: Binary;
  keyAltNames: string[];
  keyMaterial: Binary;
  masterKey: { provider: string };
};

function memoryKeyVault(docs: KeyDoc[] = []) {
  const same = (a: Binary, b: Binary) => Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
  return {
    docs,
    createIndex: vi.fn(async () => {}),
    findOne: vi.fn(
      async (filter: { keyAltNames: string } | { _id: Binary }) =>
        docs.find((doc) =>
          "_id" in filter
            ? same(doc._id, filter._id)
            : doc.keyAltNames.includes(filter.keyAltNames),
        ) ?? null,
    ),
    insertOne: vi.fn(async (doc: object) => {
      docs.push(doc as KeyDoc);
    }),
    updateOne: vi.fn(async (filter: { _id: Binary }, update: { $set: Partial<KeyDoc> }) => {
      const doc = docs.find((d) => same(d._id, filter._id));
      if (doc) Object.assign(doc, update.$set);
    }),
  };
}

const libmongocryptKey = (provider = "local", keyMaterial = LIBMONGOCRYPT.keyMaterial): KeyDoc => ({
  _id: new Binary(Buffer.from(LIBMONGOCRYPT.id, "base64"), 4),
  keyAltNames: ["alias"],
  keyMaterial: new Binary(Buffer.from(keyMaterial, "base64"), 0),
  masterKey: { provider },
});

describe("FLE on node:crypto", () => {
  it("decrypts what libmongocrypt encrypted", async () => {
    const keyVault = memoryKeyVault([libmongocryptKey()]);
    const { decrypt } = await createFleCrypto({
      keyVault,
      Binary,
      keyAlias: "alias",
      localMasterKey: MASTER_KEY,
    })();

    expect(await decrypt(new Binary(Buffer.from(LIBMONGOCRYPT.string, "base64"), 6))).toBe("héllo");
    expect(await decrypt(LIBMONGOCRYPT.binary)).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it("creates a local data key once and round-trips strings and bytes", async () => {
    const keyVault = memoryKeyVault();
    const fle = createFleCrypto({
      keyVault,
      Binary,
      keyAlias: "alias",
      localMasterKey: MASTER_KEY,
    });
    await Promise.all(Array.from({ length: 20 }, () => fle()));
    const { encrypt, decrypt } = await fle();

    expect(keyVault.findOne).toHaveBeenCalledTimes(1);
    expect(keyVault.docs).toHaveLength(1);
    expect(keyVault.docs[0]?.masterKey).toEqual({ provider: "local" });

    const secret = new Uint8Array([9, 8, 7]);
    const encrypted = await encrypt(secret);
    expect(encrypted.sub_type).toBe(6);
    expect(await decrypt(encrypted)).toEqual(Buffer.from(secret));
    expect(await decrypt(await encrypt("text"))).toBe("text");

    // A fresh process finds the stored key instead of creating another one
    const again = await createFleCrypto({
      keyVault,
      Binary,
      keyAlias: "alias",
      localMasterKey: MASTER_KEY,
    })();
    expect(await again.decrypt(encrypted)).toEqual(Buffer.from(secret));
    expect(keyVault.docs).toHaveLength(1);
  });

  it("rejects a tampered value and a wrong master key", async () => {
    const keyVault = memoryKeyVault([libmongocryptKey()]);
    const { decrypt } = await createFleCrypto({
      keyVault,
      Binary,
      keyAlias: "alias",
      localMasterKey: MASTER_KEY,
    })();

    const tampered = Buffer.from(LIBMONGOCRYPT.string, "base64");
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 1, tampered.length - 1);
    await expect(decrypt(tampered)).rejects.toThrow("failed authentication");

    const wrong = createFleCrypto({
      keyVault,
      Binary,
      keyAlias: "alias",
      localMasterKey: Buffer.alloc(96),
    });
    await expect(wrong()).rejects.toThrow("failed authentication");
  });

  it("rewraps an aws-wrapped data key to local once, keeping its _id", async () => {
    // Stand-in for KMS: the "aws" keyMaterial is the plain data key
    const plainDataKey = Buffer.alloc(96, 3);
    const keyVault = memoryKeyVault([libmongocryptKey("aws", plainDataKey.toString("base64"))]);
    const kms = { decrypt: vi.fn(async (blob: Uint8Array) => blob) };

    const { encrypt } = await createFleCrypto({
      keyVault,
      Binary,
      keyAlias: "alias",
      localMasterKey: MASTER_KEY,
      kms,
    })();

    expect(kms.decrypt).toHaveBeenCalledOnce();
    expect(keyVault.updateOne).toHaveBeenCalledOnce();
    expect(keyVault.docs[0]?.masterKey).toEqual({ provider: "local" });
    expect(Buffer.from(keyVault.docs[0]?._id.buffer ?? []).toString("base64")).toBe(
      LIBMONGOCRYPT.id,
    );

    // Afterwards the local master key alone opens it, no KMS
    const encrypted = await encrypt("after rewrap");
    const local = await createFleCrypto({
      keyVault,
      Binary,
      keyAlias: "alias",
      localMasterKey: MASTER_KEY,
    })();
    expect(await local.decrypt(encrypted)).toBe("after rewrap");
  });
});
