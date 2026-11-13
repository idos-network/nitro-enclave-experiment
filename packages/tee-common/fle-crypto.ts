// MongoDB client-side field level encryption (explicit, AEAD_AES_256_CBC_HMAC_SHA_512-Random)
// on node:crypto instead of libmongocrypt. Same key vault documents and the same ciphertext as
// mongodb-client-encryption, so data written by either side reads on the other.
//
// The driver's Binary and the key vault collection are handed in by the service, like in fle.ts.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getLogger } from "./logger.ts";

export const KEY_VAULT_COLLECTION = "__keyVault";

// FLE1 blob subtype of the Random algorithm and the BSON types we encrypt
const BLOB_RANDOM = 2;
const BSON_STRING = 0x02;
const BSON_BINARY = 0x05;
const NO_AD = Buffer.alloc(0);

type BinaryLike = { buffer: Uint8Array };

interface KeyDocument {
  _id: BinaryLike;
  keyMaterial: BinaryLike;
  masterKey: { provider: string };
}

interface KeyVault {
  createIndex(
    spec: { keyAltNames: 1 },
    options: { unique: boolean; partialFilterExpression: object },
  ): Promise<unknown>;
  findOne(filter: { keyAltNames: string } | { _id: BinaryLike }): Promise<unknown>;
  insertOne(doc: object): Promise<unknown>;
  updateOne(filter: { _id: BinaryLike }, update: object): Promise<unknown>;
}

export interface FleCryptoOptions<Bin extends BinaryLike> {
  /** `<keyDb>.__keyVault` */
  keyVault: KeyVault;
  Binary: new (buffer: Uint8Array, subType: number) => Bin;
  keyAlias: string;
  /**
   * 96-byte master key of the `local` provider: data keys are wrapped with it, not by KMS, so
   * no host-callable KMS key protects them. The service gets it from an attested KMS Decrypt.
   */
  localMasterKey?: Buffer;
  /**
   * KMS for data keys of the `aws` provider: their keyMaterial is the KMS ciphertext of the
   * data key. Without localMasterKey new data keys are created this way (masterKey.key).
   * With it, an aws-wrapped data key is rewrapped to local once, keeping its _id.
   */
  kms?: {
    masterKey?: { key: string; region: string };
    encrypt?(dataKey: Buffer): Promise<Uint8Array>;
    decrypt(keyMaterial: Uint8Array): Promise<Uint8Array>;
  };
}

/** Key = MAC key (32) || encryption key (32) || IV key (32, deterministic only). */
function tag(key: Buffer, ad: Uint8Array, ivAndCiphertext: Uint8Array) {
  const adBits = Buffer.alloc(8);
  adBits.writeBigUInt64BE(BigInt(ad.length * 8));

  return createHmac("sha512", key.subarray(0, 32))
    .update(ad)
    .update(ivAndCiphertext)
    .update(adBits)
    .digest()
    .subarray(0, 32);
}

/** IV || AES-256-CBC(plaintext) || first 32 bytes of HMAC-SHA-512(AD || IV || C || AD bit length) */
export function aeadEncrypt(key: Buffer, plaintext: Uint8Array, ad: Uint8Array): Buffer {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key.subarray(32, 64), iv);
  const ivAndCiphertext = Buffer.concat([iv, cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([ivAndCiphertext, tag(key, ad, ivAndCiphertext)]);
}

export function aeadDecrypt(key: Buffer, data: Uint8Array, ad: Uint8Array): Buffer {
  const ivAndCiphertext = data.subarray(0, -32);
  if (
    ivAndCiphertext.length < 32 ||
    !timingSafeEqual(tag(key, ad, ivAndCiphertext), data.subarray(-32))
  ) {
    throw new Error("FLE ciphertext failed authentication");
  }

  const decipher = createDecipheriv(
    "aes-256-cbc",
    key.subarray(32, 64),
    ivAndCiphertext.subarray(0, 16),
  );
  return Buffer.concat([decipher.update(ivAndCiphertext.subarray(16)), decipher.final()]);
}

/** The value as the BSON element body libmongocrypt encrypts: [type, bytes]. */
function toBson(value: string | Uint8Array): [number, Buffer] {
  const length = Buffer.alloc(4);

  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    length.writeInt32LE(bytes.length + 1);
    return [BSON_STRING, Buffer.concat([length, bytes, Buffer.alloc(1)])];
  }

  length.writeInt32LE(value.length);
  // binary subtype 0 (generic)
  return [BSON_BINARY, Buffer.concat([length, Buffer.alloc(1), value])];
}

function fromBson(type: number, bytes: Buffer): string | Buffer {
  const length = bytes.length >= 4 ? bytes.readInt32LE(0) : -1;

  if (type === BSON_STRING && length === bytes.length - 4) {
    return bytes.subarray(4, -1).toString("utf8");
  }

  if (type === BSON_BINARY && length === bytes.length - 5) {
    return bytes.subarray(5);
  }

  throw new Error(`Unsupported encrypted BSON type ${type}`);
}

type ExtendedJsonBinary = { $binary?: { base64?: string } };
type SerializedBinary = { type?: number; data?: number[] };

// Mongo returns the ciphertext in whatever shape it was written in: a driver
// Binary, a BSON Binary that lost its class over a JSON round trip, a raw
// Buffer, base64, or extended JSON. Normalizing here means every caller can
// hand over the field it read from the document as-is.
function toBytes(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === "string") {
    return Buffer.from(value, "base64");
  }

  const serialized = value as SerializedBinary | null;
  if (serialized?.type === 6 && Array.isArray(serialized.data)) {
    return Buffer.from(serialized.data);
  }

  const extendedJson = (value as ExtendedJsonBinary | null)?.$binary;
  if (extendedJson?.base64) {
    return Buffer.from(extendedJson.base64, "base64");
  }

  const binary = (value as BinaryLike | null)?.buffer;
  if (binary instanceof Uint8Array) {
    return Buffer.from(binary);
  }

  throw new Error("Invalid encrypted payload format");
}

/**
 * Returns a function that resolves the data key (once per process) and gives back
 * encrypt/decrypt bound to it.
 */
export function createFleCrypto<Bin extends BinaryLike>(options: FleCryptoOptions<Bin>) {
  const { keyVault, Binary, keyAlias, localMasterKey, kms } = options;

  async function unwrap(key: KeyDocument): Promise<Buffer> {
    if (key.masterKey.provider === "local") {
      if (!localMasterKey) {
        throw new Error("Data key is wrapped by the local provider, no local master key");
      }
      return aeadDecrypt(localMasterKey, key.keyMaterial.buffer, NO_AD);
    }

    if (key.masterKey.provider !== "aws" || !kms) {
      throw new Error(`Data key is wrapped by ${key.masterKey.provider}, no KMS for it`);
    }

    const dataKey = Buffer.from(await kms.decrypt(key.keyMaterial.buffer));

    if (localMasterKey) {
      // One-off migration: rewrap with the local master key. The _id stays, so encrypted fields
      // keep decrypting. It needs a plain kms:Decrypt by the host role, so it has to run before
      // the key policy requires PCRs.
      await keyVault.updateOne(
        { _id: key._id },
        {
          $set: {
            keyMaterial: new Binary(aeadEncrypt(localMasterKey, dataKey, NO_AD), 0),
            masterKey: { provider: "local" },
            updateDate: new Date(),
          },
        },
      );
      getLogger().info({ rewrapped: 1 }, "FLE data keys rewrapped from aws to local");
    }

    return dataKey;
  }

  async function create(): Promise<{ id: Buffer; dataKey: Buffer }> {
    const dataKey = randomBytes(96);
    let keyMaterial: Uint8Array;
    let masterKey: object;

    if (localMasterKey) {
      keyMaterial = aeadEncrypt(localMasterKey, dataKey, NO_AD);
      masterKey = { provider: "local" };
    } else if (kms?.masterKey && kms.encrypt) {
      keyMaterial = await kms.encrypt(dataKey);
      masterKey = { provider: "aws", ...kms.masterKey };
    } else {
      throw new Error(`Data key ${keyAlias} does not exist`);
    }

    // UUID v4, stored as BSON Binary subtype 4 like libmongocrypt's
    const id = randomBytes(16);
    id.writeUInt8((id.readUInt8(6) & 0x0f) | 0x40, 6);
    id.writeUInt8((id.readUInt8(8) & 0x3f) | 0x80, 8);
    const now = new Date();

    await keyVault.insertOne({
      _id: new Binary(id, 4),
      keyAltNames: [keyAlias],
      keyMaterial: new Binary(keyMaterial, 0),
      creationDate: now,
      updateDate: now,
      status: 0,
      masterKey,
    });

    return { id, dataKey };
  }

  /** Find or create the data encryption key of keyAlias. */
  async function ensureKey(): Promise<{ id: Buffer; dataKey: Buffer }> {
    await keyVault.createIndex(
      { keyAltNames: 1 },
      { unique: true, partialFilterExpression: { keyAltNames: { $exists: true } } },
    );

    const key = (await keyVault.findOne({ keyAltNames: keyAlias })) as KeyDocument | null;
    const resolved = key
      ? { id: Buffer.from(key._id.buffer), dataKey: await unwrap(key) }
      : await create();

    dataKeys.set(resolved.id.toString("hex"), Promise.resolve(resolved.dataKey));
    return resolved;
  }

  // Keys never change once created, so each is resolved and unwrapped once per process (it
  // stays in enclave memory). Cleared on failure so a transient error isn't cached forever.
  let keyPromise: Promise<{ id: Buffer; dataKey: Buffer }> | null = null;
  const dataKeys = new Map<string, Promise<Buffer>>();

  function ensureKeyOnce() {
    keyPromise ??= ensureKey().catch((error) => {
      keyPromise = null;
      throw error;
    });

    return keyPromise;
  }

  // Like libmongocrypt, decrypt takes the data key named in the ciphertext, not only keyAlias's
  function dataKeyById(id: Buffer): Promise<Buffer> {
    const hex = id.toString("hex");
    let dataKey = dataKeys.get(hex);

    if (!dataKey) {
      dataKey = (async () => {
        const key = (await keyVault.findOne({ _id: new Binary(id, 4) })) as KeyDocument | null;
        if (!key) {
          throw new Error(`Data key ${hex} does not exist`);
        }
        return await unwrap(key);
      })().catch((error) => {
        dataKeys.delete(hex);
        throw error;
      });
      dataKeys.set(hex, dataKey);
    }

    return dataKey;
  }

  return async () => {
    const { id, dataKey } = await ensureKeyOnce();

    return {
      /** Binary subtype 6: blob subtype || key UUID || BSON type || AEAD ciphertext */
      encrypt: async (value: string | Uint8Array): Promise<Bin> => {
        const [type, plaintext] = toBson(value);
        const ad = Buffer.concat([Buffer.from([BLOB_RANDOM]), id, Buffer.from([type])]);

        return new Binary(Buffer.concat([ad, aeadEncrypt(dataKey, plaintext, ad)]), 6);
      },
      /** A string, or a Buffer for binary values. */
      decrypt: async <T extends string | Buffer>(value: unknown): Promise<T> => {
        const blob = toBytes(value);
        if (blob.length < 18 || blob[0] !== BLOB_RANDOM) {
          throw new Error("Not an FLE Random ciphertext");
        }

        const ad = blob.subarray(0, 18);
        const key = await dataKeyById(blob.subarray(1, 17));
        return fromBson(blob[17] ?? 0, aeadDecrypt(key, blob.subarray(18), ad)) as T;
      },
    };
  };
}
