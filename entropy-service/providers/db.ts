import { defaultProvider } from "@aws-sdk/credential-provider-node";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  Binary,
  ClientEncryption,
  type Db,
  type Document,
  MongoClient,
  MongoServerError,
  type UUID,
  type WithId,
} from "mongodb";
import {
  AWS_REGION,
  DB_NAME,
  FACE_SIGN_ENTROPY_COLLECTION,
  FLE_KEY_ALIAS,
  FLE_KMS_KEY_ID,
  MONGO_URI,
} from "../env.ts";

let db: Db | null = null;

// FLE configuration
const KEY_DB = "encryption";
const KEY_COLLECTION = "__keyVault";
const keyVaultNamespace = `${KEY_DB}.${KEY_COLLECTION}`;

const client = new MongoClient(MONGO_URI, {
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

// Every DEK cache miss costs a KMS decrypt over a fresh TLS connection through
// the socat vsock proxy. An hour instead of the 60s default keeps the key in
// enclave memory longer - inside the trust boundary either way - in exchange
// for ~60x fewer KMS round trips.
const KEY_EXPIRATION_MS = 60 * 60 * 1000;

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

  // Check if collection exists
  const collections = await client.db(KEY_DB).listCollections({}, { nameOnly: true }).toArray();

  const collectionExists = collections.some((c) => c.name === KEY_COLLECTION);

  if (!collectionExists) {
    // Initialize key storage
    await client.db(KEY_DB).createCollection(KEY_COLLECTION);
    await client
      .db(KEY_DB)
      .collection(KEY_COLLECTION)
      .createIndex(
        { keyAltNames: 1 },
        {
          unique: true,
          partialFilterExpression: { keyAltNames: { $exists: true } },
        },
      );
  }

  const clientEncryption = await getClientEncryption();
  const existingKey = await clientEncryption.getKeyByAltName(FLE_KEY_ALIAS);

  if (existingKey) {
    return existingKey._id;
  }

  return await clientEncryption.createDataKey("aws", {
    masterKey: {
      key: FLE_KMS_KEY_ID,
      region: AWS_REGION,
    },
    keyAltNames: [FLE_KEY_ALIAS],
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

type ExtendedJsonBinary = { $binary?: { base64?: string; subType: string } };

// Mongo returns the ciphertext in whatever shape it was written in: a driver
// Binary, a raw Buffer, base64, or extended JSON. Normalizing here means every
// caller can hand over the field it read from the document as-is.
function toBinary(value: unknown): Binary {
  if (value instanceof Binary) {
    return value;
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

  throw new Error("Invalid entropy format");
}

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(DB_NAME);

    // Create a unique index on faceSignUserId
    await db
      .collection(FACE_SIGN_ENTROPY_COLLECTION)
      .createIndex({ faceSignUserId: 1 }, { unique: true });
  }

  const dataKeyId = await ensureKeyOnce();
  const clientEncryption = getClientEncryption();

  return {
    db,
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
}

export async function fetchOrCreateFaceSignEntropy(
  faceSignUserId: string,
): Promise<{ insert: boolean; entropy: string }> {
  const { db, encrypt, decrypt } = await connectDB();
  const collection = db.collection(FACE_SIGN_ENTROPY_COLLECTION);

  // try to find existing encrypted record
  const existing = await collection.findOne({ faceSignUserId });

  if (existing?.entropy) {
    const decrypted = await decrypt<Buffer>(existing.entropy);
    return { insert: false, entropy: decrypted.toString() };
  }

  // create new entropy and encrypt
  const mnemonic = bip39.generateMnemonic(wordlist, 256);
  const encryptedEntropy = await encrypt(mnemonic);

  // $setOnInsert + upsert leaves exactly one entropy per user, but the caller
  // that loses the race must return the *stored* one, not the mnemonic it just
  // generated and threw away.
  let stored: WithId<Document> | null;

  try {
    stored = await collection.findOneAndUpdate(
      { faceSignUserId },
      { $setOnInsert: { entropy: encryptedEntropy } },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    // A racing insert that landed between our findOne and the upsert surfaces
    // against the unique index as E11000; the winner's document is now there.
    if (!(error instanceof MongoServerError) || error.code !== 11000) {
      throw error;
    }

    stored = await collection.findOne({ faceSignUserId });
  }

  if (!stored?.entropy) {
    throw new Error("Entropy upsert stored no document");
  }

  const entropy = (await decrypt<Buffer>(stored.entropy)).toString();

  // We created it only if what is stored is the mnemonic we generated.
  return { insert: entropy === mnemonic, entropy };
}
