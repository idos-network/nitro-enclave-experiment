//
// This script is used to repopulate the 3d-db with users from our own DB
//
import { getMembers } from "./db.js";
import { enrollUser, searchForDuplicates } from "./api.js";
import { GROUP_NAME, FACETEC_DEVICE_KEY, MONGO_URI } from "./env.js";
import { MongoClient } from "mongodb";

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

let db;

export async function connect2B() {
  if (!db) {
    await client.connect();
    db = client.db("facetec-sdk-data");
  }

  return db;
}


async function repopulate3dDb() {
  console.log(`Repopulating 3d-db with ${members.length} users...`);

  const database = await connect2B();
  const externalDatabaseRefID = await database.collection("Session").find({ success: true }, { externalDatabaseRefID: 1 }).toArray()
    .then(results => results.map(x => x.externalDatabaseRefID));
  let i = 0;

  for (const faceSignUserId of externalDatabaseRefID) {
    try {
      i++;

      if (i % 1000 === 0) {
        console.log(`Processed ${i}/${externalDatabaseRefID.length} users...`);
      }
      const searchResult = await searchForDuplicates(faceSignUserId, FACETEC_DEVICE_KEY, GROUP_NAME);

      if (searchResult.success && searchResult.results.length > 1) {
        console.log("Problematic faceSignUserId, already has multiple entries:", faceSignUserId);
        console.log(JSON.stringify(searchResult.results, null, 2));
      }

    } catch (err) {
      console.error(err);
    }
  }

  console.log("Repopulation complete.");
}

repopulate3dDb();
