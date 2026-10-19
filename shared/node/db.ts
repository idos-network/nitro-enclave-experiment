import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Binary, ClientEncryption, MongoClient, type UUID } from "mongodb";

const KEY_COLLECTION = "__keyVault";

// Every DEK cache miss costs a KMS decrypt over a fresh TLS connection through
// the socat vsock proxy. An hour instead of the 60s default keeps the key in
// enclave memory longer - inside the trust boundary either way - in exchange
// for ~60x fewer KMS round trips.
const KEY_EXPIRATION_MS = 60 * 60 * 1000;

type ExtendedJsonBinary = { $binary?: { base64?: string; subType: string } };
type SerializedBinary = { type?: number; data?: number[] };

// Mongo returns the ciphertext in whatever shape it was written in: a driver
// Binary, a BSON Binary that lost its class over a JSON round trip, a raw
// Buffer, base64, or extended JSON. Normalizing here means every caller can
// hand over the field it read from the document as-is.
function toBinary(value: unknown): Binary {
  if (value instanceof Binary) {
    return value;
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

export type FleOptions = {
  keyDb: string;
  keyAlias: string;
  // KMS key the data key is created with when missing. Without it a missing key
  // vault or data key is an error (another service owns the key).
  masterKey?: { key: string; region: string };
};

/**
 * MongoClient plus client-side field level encryption bound to one data key.
 */
export function createEncryptedClient(uri: string, { keyDb, keyAlias, masterKey }: FleOptions) {
  const keyVaultNamespace = `${keyDb}.${KEY_COLLECTION}`;

  const client = new MongoClient(uri, {
    maxPoolSize: 40,
    wtimeoutMS: 2500,
  });

  const credentialsProvider = defaultProvider();

  // One ClientEncryption for the whole process. Each instance owns its own
  // libmongocrypt handle, and therefore its own data-encryption-key cache
  // (keyExpirationMS, 60s by default), so building one per request meant a KMS
  // round trip for every encrypt/decrypt. Under load that saturates the socat
  // vsock proxy and fails as "MongoCryptError: KMS request failed" / ECONNRESET.
  //
  // An empty `aws: {}` opts into driver-side credential fetching through
  // credentialProviders, so this long-lived instance refreshes credentials
  // instead of pinning whichever ones existed at startup.
  let clientEncryption: ClientEncryption | null = null;

  function getClientEncryption(): ClientEncryption {
    clientEncryption ??= new ClientEncryption(client, {
      keyVaultNamespace,
      kmsProviders: { aws: {} },
      credentialProviders: { aws: credentialsProvider },
      keyExpirationMS: KEY_EXPIRATION_MS,
    });

    return clientEncryption;
  }

  /**
   * Find or create the data encryption key
   */
  async function ensureKey(): Promise<UUID> {
    await client.connect();

    const collections = await client.db(keyDb).listCollections({}, { nameOnly: true }).toArray();

    if (!collections.some((c) => c.name === KEY_COLLECTION)) {
      if (!masterKey) {
        throw new Error(`Key vault ${keyVaultNamespace} does not exist`);
      }

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
      return existingKey._id;
    }

    if (!masterKey) {
      throw new Error(`Data key ${keyAlias} does not exist in ${keyVaultNamespace}`);
    }

    return await getClientEncryption().createDataKey("aws", {
      masterKey,
      keyAltNames: [keyAlias],
    });
  }

  // ensureKey() costs a listCollections + getKeyByAltName round trip, and the key
  // never changes once created, so resolve it once per process rather than per
  // request. Cleared on failure so a transient error isn't cached forever.
  let dataKeyIdPromise: Promise<UUID> | null = null;

  function ensureKeyOnce(): Promise<UUID> {
    dataKeyIdPromise ??= ensureKey().catch((error) => {
      dataKeyIdPromise = null;
      throw error;
    });

    return dataKeyIdPromise;
  }

  return {
    client,
    /** encrypt/decrypt with the data key; connects and resolves the key on first use */
    async codec() {
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
    },
  };
}
