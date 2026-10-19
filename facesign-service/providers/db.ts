import { type Db, MongoServerError } from "mongodb";
import {
  DB_COLLECTION_NAME,
  DB_NAME,
  FACETEC_DB_NAME,
  FACETEC_SESSION_COLLECTION,
  MONGO_URI,
} from "../env.ts";
import { createEncryptedClient } from "../shared/node/db.ts";

let db: Db | null = null;
let facetecDataDb: Db | null = null;

const { client, codec } = createEncryptedClient(MONGO_URI, {
  keyDb: "facetec-server-encryption",
  // Created by the FaceTec server, never by this service
  keyAlias: "fle-images-encryption",
});

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

  return { db, facetecDataDb, ...(await codec()) };
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

  // biome-ignore lint/suspicious/noExplicitAny: decrypt returns whatever was stored
  const decrypted = await decrypt<any>(image);
  return Buffer.from(decrypted.buffer, "base64");
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
