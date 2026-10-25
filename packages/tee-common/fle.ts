// MongoDB client-side field level encryption shared by the services.
//
// The mongodb driver is handed in by the service instead of imported here: a second copy
// resolved from this package would break `instanceof` checks and the services' vi.mock("mongodb").
// That is also why the driver is described structurally below rather than with its own types.

import { getLogger } from "./logger.ts";

const KEY_COLLECTION = "__keyVault";

// Every DEK cache miss costs a KMS decrypt over a fresh TLS connection through
// the socat vsock proxy. An hour instead of the 60s default keeps the key in
// enclave memory longer - inside the trust boundary either way - in exchange
// for ~60x fewer KMS round trips.
const KEY_EXPIRATION_MS = 60 * 60 * 1000;

interface KeyVaultClient {
  connect(): Promise<unknown>;
  db(name: string): {
    listCollections(
      filter: object,
      options: { nameOnly: true },
    ): { toArray(): Promise<{ name: string }[]> };
    createCollection(name: string): Promise<unknown>;
    collection(name: string): {
      createIndex(
        spec: { keyAltNames: 1 },
        options: { unique: boolean; partialFilterExpression: object },
      ): Promise<unknown>;
    };
  };
}

interface Encryption<KeyId, Bin> {
  getKeyByAltName(alias: string): Promise<{ _id: KeyId; masterKey?: { provider?: string } } | null>;
  createDataKey(
    provider: "aws" | "local",
    options: { masterKey?: { key: string; region: string }; keyAltNames: string[] },
  ): Promise<KeyId>;
  rewrapManyDataKey(
    filter: object,
    options: { provider: "local" },
  ): Promise<{ bulkWriteResult?: { modifiedCount?: number } }>;
  encrypt(
    value: string | Buffer | Uint8Array,
    options: { keyId: KeyId; algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random" },
  ): Promise<Bin>;
  decrypt<T>(value: Bin): Promise<T>;
}

export interface FleOptions<Client extends KeyVaultClient, Credentials, KeyId, Bin> {
  client: Client;
  ClientEncryption: new (
    client: Client,
    options: {
      keyVaultNamespace: string;
      kmsProviders: { aws?: Record<string, never>; local?: { key: Buffer } };
      credentialProviders?: { aws: Credentials };
      keyExpirationMS: number;
    },
  ) => Encryption<KeyId, Bin>;
  credentialsProvider: Credentials;
  /** Database holding the `__keyVault` collection. */
  keyDb: string;
  keyAlias: string;
  /** KMS key used to create the vault and data key when missing. Without it they must already exist. */
  masterKey?: { key: string; region: string };
  /**
   * 96-byte master key of the `local` KMS provider. With it data keys are wrapped locally
   * instead of by KMS: libmongocrypt's KMS Decrypt can't carry a Recipient attestation, so the
   * `aws` provider works with the host's bare instance-role credentials. The service gets this
   * key from an attested KMS Decrypt at boot.
   */
  localMasterKey?: Buffer;
  /** Pass the driver's Binary to let decrypt() take any shape the ciphertext was stored in. */
  Binary?: new (
    buffer: Buffer,
    subType: number,
  ) => Bin;
}

type ExtendedJsonBinary = { $binary?: { base64?: string; subType: string } };
type SerializedBinary = { type?: number; data?: number[] };

/**
 * Returns a function that resolves the data key (once per process) and gives back
 * encrypt/decrypt bound to it.
 */
export function createFle<Client extends KeyVaultClient, Credentials, KeyId, Bin>(
  options: FleOptions<Client, Credentials, KeyId, Bin>,
) {
  const { client, keyDb, keyAlias, masterKey, localMasterKey, Binary } = options;
  const keyVaultNamespace = `${keyDb}.${KEY_COLLECTION}`;

  // One ClientEncryption for the whole process. Each instance owns its own
  // libmongocrypt handle, and therefore its own data-encryption-key cache
  // (keyExpirationMS, 60s by default), so building one per request meant a KMS
  // round trip for every encrypt/decrypt. Under load that saturates the socat
  // vsock proxy and fails as "MongoCryptError: KMS request failed" / ECONNRESET.
  //
  // An empty `aws: {}` opts into driver-side credential fetching through
  // credentialProviders, so this long-lived instance refreshes credentials
  // instead of pinning whichever ones existed at startup.
  let clientEncryption: Encryption<KeyId, Bin> | null = null;

  function getClientEncryption(): Encryption<KeyId, Bin> {
    clientEncryption ??= new options.ClientEncryption(client, {
      keyVaultNamespace,
      keyExpirationMS: KEY_EXPIRATION_MS,
      ...(localMasterKey
        ? { kmsProviders: { local: { key: localMasterKey } } }
        : { kmsProviders: { aws: {} }, credentialProviders: { aws: options.credentialsProvider } }),
    });

    return clientEncryption;
  }

  /**
   * One-off migration: rewrap data keys still wrapped by KMS (`aws` provider) with the local
   * master key. Their _id stays, so encrypted fields keep decrypting. It needs a plain
   * kms:Decrypt by the host role, so it has to run before the key policy requires PCRs.
   */
  async function rewrapAwsDataKeys(key: Buffer) {
    const rewrap = new options.ClientEncryption(client, {
      keyVaultNamespace,
      keyExpirationMS: KEY_EXPIRATION_MS,
      kmsProviders: { aws: {}, local: { key } },
      credentialProviders: { aws: options.credentialsProvider },
    });

    const { bulkWriteResult } = await rewrap.rewrapManyDataKey(
      { "masterKey.provider": "aws" },
      { provider: "local" },
    );

    getLogger().info(
      { rewrapped: bulkWriteResult?.modifiedCount ?? 0 },
      "FLE data keys rewrapped from aws to local",
    );
  }

  /** Find or create the data encryption key. */
  async function ensureKey(): Promise<KeyId> {
    await client.connect();

    const collections = await client.db(keyDb).listCollections({}, { nameOnly: true }).toArray();

    if (!collections.some((c) => c.name === KEY_COLLECTION)) {
      if (!masterKey && !localMasterKey) {
        throw new Error(`Key vault ${keyDb}.${KEY_COLLECTION} does not exist`);
      }

      // Initialize key storage
      await client.db(keyDb).createCollection(KEY_COLLECTION);
      await client
        .db(keyDb)
        .collection(KEY_COLLECTION)
        .createIndex(
          { keyAltNames: 1 },
          {
            unique: true,
            partialFilterExpression: { keyAltNames: { $exists: true } },
          },
        );
    }

    const existingKey = await getClientEncryption().getKeyByAltName(keyAlias);

    if (existingKey) {
      if (localMasterKey && existingKey.masterKey?.provider === "aws") {
        await rewrapAwsDataKeys(localMasterKey);
      }

      return existingKey._id;
    }

    if (localMasterKey) {
      return await getClientEncryption().createDataKey("local", { keyAltNames: [keyAlias] });
    }

    if (!masterKey) {
      throw new Error(`Data key ${keyAlias} does not exist in ${keyDb}.${KEY_COLLECTION}`);
    }

    return await getClientEncryption().createDataKey("aws", { masterKey, keyAltNames: [keyAlias] });
  }

  // ensureKey() costs a listCollections + getKeyByAltName round trip, and the key
  // never changes once created, so resolve it once per process rather than per
  // request. Cleared on failure so a transient error isn't cached forever.
  let dataKeyIdPromise: Promise<KeyId> | null = null;

  function ensureKeyOnce(): Promise<KeyId> {
    dataKeyIdPromise ??= ensureKey().catch((error) => {
      dataKeyIdPromise = null;
      throw error;
    });

    return dataKeyIdPromise;
  }

  // Mongo returns the ciphertext in whatever shape it was written in: a driver
  // Binary, a BSON Binary that lost its class over a JSON round trip, a raw
  // Buffer, base64, or extended JSON. Normalizing here means every caller can
  // hand over the field it read from the document as-is.
  function toBinary(value: unknown): Bin {
    if (!Binary || value instanceof Binary) {
      return value as Bin;
    }

    const serialized = value as SerializedBinary | null;
    if (serialized?.type === 6 && Array.isArray(serialized.data)) {
      return new Binary(Buffer.from(serialized.data), 6);
    }

    if (Buffer.isBuffer(value)) {
      return new Binary(value, 6);
    }

    if (typeof value === "string") {
      return new Binary(Buffer.from(value, "base64"), 6);
    }

    const extendedJson = (value as ExtendedJsonBinary | null)?.$binary;
    if (extendedJson?.base64) {
      return new Binary(
        Buffer.from(extendedJson.base64, "base64"),
        Number.parseInt(extendedJson.subType, 16),
      );
    }

    throw new Error("Invalid encrypted payload format");
  }

  return async () => {
    const dataKeyId = await ensureKeyOnce();
    const clientEncryption = getClientEncryption();

    return {
      encrypt: async (value: string | Buffer | Uint8Array) => {
        return clientEncryption.encrypt(value, {
          keyId: dataKeyId,
          algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
        });
      },
      decrypt: async <T>(value: unknown): Promise<T> => {
        return clientEncryption.decrypt<T>(toBinary(value));
      },
    };
  };
}
