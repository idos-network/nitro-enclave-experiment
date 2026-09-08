import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { type Binary, ClientEncryption, type Db, MongoClient, type UUID } from "mongodb";
import type { BoxKeyPair } from "tweetnacl";
import {
  AWS_REGION,
  DB_ENCLAVE_COLLECTION,
  DB_NAME,
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

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(DB_NAME);
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
    decrypt: async <T>(value: Binary): Promise<T> => {
      return clientEncryption.decrypt<T>(value);
    },
  };
}

export interface SessionRecordDocument {
  sessionId: string;
  sessionClientPublicKeyB64: string;
  sessionServerPublicKeyB64: string;
  sessionServerPrivateKeyEnc: Binary;
  sessionServerJwtChainEnc: Binary;
  allowedAudienceRootsEnc: Binary;
  createdAt: Date;
}

export async function storeSession(
  sessionId: string,
  sessionServerKeyPair: BoxKeyPair,
  sessionClientPublicKeyB64: string,
  sessionServerJwtChain: string,
  allowedAudienceRoots: string[],
) {
  const { db, encrypt } = await connectDB();

  const [sessionServerPrivateKeyEnc, sessionServerJwtChainEnc, allowedAudienceRootsEnc] =
    await Promise.all([
      encrypt(sessionServerKeyPair.secretKey),
      encrypt(sessionServerJwtChain),
      encrypt(JSON.stringify(allowedAudienceRoots)),
    ]);

  const record: SessionRecordDocument = {
    sessionId,
    sessionServerPrivateKeyEnc,
    sessionServerPublicKeyB64: Buffer.from(sessionServerKeyPair.publicKey).toString("base64url"),
    sessionClientPublicKeyB64,
    sessionServerJwtChainEnc,
    allowedAudienceRootsEnc,
    createdAt: new Date(),
  };

  await db.collection(DB_ENCLAVE_COLLECTION).insertOne(record);
}

export interface Session {
  id: string;
  allowedAudienceRoots: string[];
  sessionClientPublicKey: Uint8Array;
  sessionServerPublicKey: Uint8Array;
  sessionServerPrivateKey: Uint8Array;
  sessionServerJwtChain: string;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const { db, decrypt } = await connectDB();

  const session = await db
    .collection<SessionRecordDocument>(DB_ENCLAVE_COLLECTION)
    .findOne({ sessionId });

  if (!session) {
    return null;
  }

  // TODO: TTL!

  const [sessionServerPrivateKey, allowedAudienceRoots, sessionServerJwtChain] = await Promise.all([
    decrypt<Binary>(session.sessionServerPrivateKeyEnc),
    decrypt<string>(session.allowedAudienceRootsEnc),
    decrypt<string>(session.sessionServerJwtChainEnc),
  ]);

  return {
    id: sessionId,
    allowedAudienceRoots: JSON.parse(allowedAudienceRoots),
    sessionClientPublicKey: Buffer.from(session.sessionClientPublicKeyB64, "base64url"),
    sessionServerPrivateKey: sessionServerPrivateKey.buffer,
    sessionServerPublicKey: Buffer.from(session.sessionServerPublicKeyB64, "base64url"),
    sessionServerJwtChain,
  };
}
