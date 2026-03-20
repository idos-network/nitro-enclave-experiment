import { defaultProvider } from "@aws-sdk/credential-provider-node";
import {
  Binary,
  ClientEncryption,
  type Db,
  MongoClient,
  MongoServerError,
  type UUID,
} from "mongodb";
import {
  DB_COLLECTION_NAME,
  DB_NAME,
  FACETEC_DB_NAME,
  FACETEC_SESSION_COLLECTION,
  MONGO_URI,
} from "../env.ts";

// FLE configuration
const KEY_DB = "facetec-server-encryption";
const KEY_COLLECTION = "__keyVault";
const FLE_KEY_ALIAS = "fle-images-encryption";
const keyVaultNamespace = `${KEY_DB}.${KEY_COLLECTION}`;

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

let db: Db | null = null;
let facetecDataDb: Db | null = null;
let cacheClientEncryption: ClientEncryption | null = null;

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

  cacheClientEncryption = new ClientEncryption(client, {
    keyVaultNamespace,
    kmsProviders,
  });

  return cacheClientEncryption;
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
    throw new Error("Key collection does not exists, run FaceTec server first!");
  }

  const clientEncryption = await getClientEncryption();
  const existingKey = await clientEncryption.getKeyByAltName(FLE_KEY_ALIAS);

  if (!existingKey) {
    throw new Error("Key does not exists, run FaceTec server first!");
  }

  return existingKey._id;
}

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(DB_NAME);

    // Create a member group members with unique users
    await db
      .collection(DB_COLLECTION_NAME)
      .createIndex({ groupName: 1, faceSignUserId: 1 }, { unique: true });
  }

  if (!facetecDataDb) {
    facetecDataDb = client.db(FACETEC_DB_NAME);
  }

  const dataKeyId = await ensureKey();
  const clientEncryption = await getClientEncryption();

  return {
    db,
    facetecDataDb,
    encrypt: async (value: string) => {
      return clientEncryption.encrypt(value, {
        keyId: dataKeyId,
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      });
    },
    decrypt: async (value: Binary) => {
      return clientEncryption.decrypt(value);
    },
  };
}

export async function getOldestFaceSignUserId(identifiers: string[]): Promise<string> {
  const { facetecDataDb } = await connectDB();
  const sessionsCollection = facetecDataDb.collection(FACETEC_SESSION_COLLECTION);

  const sessions = await sessionsCollection
    .find(
      { externalDatabaseRefID: { $in: identifiers } },
      { projection: { externalDatabaseRefID: 1, "callData.date": 1 } },
    )
    .sort({ "callData.date": 1 })
    .limit(1)
    .toArray();

  if (sessions[0]) {
    return sessions[0].externalDatabaseRefID;
  }

  throw new Error("No sessions found for provided identifiers.");
}

export async function getAuditTrailImage(
  externalDatabaseRefID: string,
): Promise<Buffer<ArrayBuffer> | null> {
  const { facetecDataDb, decrypt } = await connectDB();

  const records = await facetecDataDb
    .collection(FACETEC_SESSION_COLLECTION)
    .find({ externalDatabaseRefID, "data.auditTrailImage": { $exists: true } })
    .sort({ "callData.date": -1 })
    .limit(1)
    .toArray();

  if (!records || records.length === 0) {
    return null;
  }

  const image = records[0]?.data.auditTrailImage;

  if (!image) {
    return null;
  }

  // Convert from encrypted BSON to base64
  let payloadForDecrypt: any = image;

  // Check for proper binary type = 6, data = array
  if (
    typeof payloadForDecrypt === "object" &&
    payloadForDecrypt.type === 6 &&
    Array.isArray(payloadForDecrypt.data)
  ) {
    payloadForDecrypt = new Binary(payloadForDecrypt.data, 6);
  } else if (Buffer.isBuffer(payloadForDecrypt)) {
    payloadForDecrypt = new Binary(payloadForDecrypt, 6);
  } else if (typeof payloadForDecrypt === "string") {
    const buf = Buffer.from(payloadForDecrypt, "base64");
    payloadForDecrypt = new Binary(buf, 6);
  } else if (payloadForDecrypt?.$binary?.base64) {
    const buf = Buffer.from(payloadForDecrypt.$binary.base64, "base64");
    payloadForDecrypt = new Binary(buf, Number.parseInt(payloadForDecrypt.$binary.subType, 16));
  }

  if (!payloadForDecrypt) {
    throw new Error("Invalid entropy format");
  }

  const decrypted = await decrypt(payloadForDecrypt);
  return Buffer.from(decrypted.buffer, "base64");
}

export async function deleteAuditTrailImage(externalDatabaseRefID: string) {
  const { facetecDataDb } = await connectDB();

  await facetecDataDb
    .collection(FACETEC_SESSION_COLLECTION)
    .updateOne({ externalDatabaseRefID }, { $unset: { "data.auditTrailImage": "" } });
}

export async function deleteAuditTrailImagesOlderThan14Days() {
  const { facetecDataDb } = await connectDB();

  await facetecDataDb.collection(FACETEC_SESSION_COLLECTION).updateMany(
    {
      "data.auditTrailImage": { $exists: true },
      "callData.date": { $lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    },
    { $unset: { "data.auditTrailImage": "" } },
  );
}

export async function countMembersInGroup(groupName: string) {
  const { db } = await connectDB();
  const count = await db.collection(DB_COLLECTION_NAME).countDocuments({ groupName });
  return count;
}

export async function getMembers(groupName: string) {
  const { db } = await connectDB();
  const members = await db.collection(DB_COLLECTION_NAME).find({ groupName }).toArray();
  return members.map((x) => x.faceSignUserId);
}

export async function insertMember({ groupName, userId }: { groupName: string; userId: string }) {
  const { db } = await connectDB();

  try {
    const result = await db.collection(DB_COLLECTION_NAME).insertOne({
      groupName,
      faceSignUserId: userId,
      createdAt: new Date(),
    });

    return result;
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      console.log("faceSignId already exists:", userId);
      return null;
    }

    throw err;
  }
}
