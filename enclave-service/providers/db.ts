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
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

async function ensureKmsProviders() {
  const credentialsProvider = defaultProvider();
  const credentials = await credentialsProvider();

  return {
    aws: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      // For some reason the types say sessionToken is string, but it can be undefined
      // and it's trying to set never to string... it's weird
      // biome-ignore lint/suspicious/noExplicitAny: invalid types
      sessionToken: credentials.sessionToken as any,
    },
  };
}

async function getClientEncryption() {
  const kmsProviders = await ensureKmsProviders();

  return new ClientEncryption(client, {
    keyVaultNamespace,
    kmsProviders,
  });
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

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(DB_NAME);
  }

  const dataKeyId = await ensureKey();
  const clientEncryption = await getClientEncryption();

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
