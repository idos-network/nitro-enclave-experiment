import { MongoClient } from "mongodb";
import { MONGO_URI, DB_COLLECTION_NAME } from "./env.js";

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

let db;

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db("face-sign-data");

    // Create a member group members with unique users
    await db.collection(DB_COLLECTION_NAME).createIndex(
      { groupName: 1, faceSignUserId: 1 },
      { unique: true }
    );
  }

  return db;
}

export async function countMembersInGroup(groupName) {
  const database = await connectDB();
  const count = await database.collection(DB_COLLECTION_NAME).countDocuments({ groupName });
  return count;
}

export async function getMembers(groupName) {
  const database = await connectDB();
  const members = await database.collection(DB_COLLECTION_NAME).find({ groupName }).toArray();
  return members.map(x => x.faceSignUserId);
}

export async function insertMember(groupName, faceSignUserId) {
  const database = await connectDB();
  try {
    const result = await database.collection(DB_COLLECTION_NAME).insertOne({
      groupName,
      faceSignUserId,
      createdAt: new Date()
    });

    return result;
  } catch (err) {
    if (err.code === 11000) {
      console.log("faceSignId already exists:", faceSignUserId);
      return null;
    }

    throw err;
  }
}
