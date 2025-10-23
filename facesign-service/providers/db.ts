import { type Db, MongoClient, MongoServerError } from "mongodb";
import { DB_COLLECTION_NAME, DB_NAME, FACETEC_DB_NAME, FACETEC_SESSION_COLLECTION, MONGO_URI } from "../env.ts";

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

let db: Db | null = null;

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(DB_NAME);

    // Create a member group members with unique users
    await db
      .collection(DB_COLLECTION_NAME)
      .createIndex({ groupName: 1, faceSignUserId: 1 }, { unique: true });
  }

  return db;
}

export async function getOldestFaceSignUserId(identifiers: string[]) {
  const facetecDb = client.db(FACETEC_DB_NAME);
  const sessionsCollection = facetecDb.collection(FACETEC_SESSION_COLLECTION);

  const sessions = await sessionsCollection
    .find({ externalDatabaseRefID: { $in: identifiers } }, { projection: { externalDatabaseRefID: 1, "callData.date": 1 } })
    .sort({ "callData.date": 1 })
    .limit(1)
    .toArray();

  if (sessions[0]) {
    return sessions[0].externalDatabaseRefID;
  }

  throw new Error("No sessions found for provided identifiers.");
}

export async function countMembersInGroup(groupName: string) {
  const database = await connectDB();
  const count = await database.collection(DB_COLLECTION_NAME).countDocuments({ groupName });
  return count;
}

export async function getMembers(groupName: string) {
  const database = await connectDB();
  const members = await database.collection(DB_COLLECTION_NAME).find({ groupName }).toArray();
  return members.map((x) => x.faceSignUserId);
}

export async function insertMember(groupName: string, faceSignUserId: string) {
  const database = await connectDB();

  try {
    const result = await database.collection(DB_COLLECTION_NAME).insertOne({
      groupName,
      faceSignUserId,
      createdAt: new Date(),
    });

    return result;
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      console.log("faceSignId already exists:", faceSignUserId);
      return null;
    }

    throw err;
  }
}
