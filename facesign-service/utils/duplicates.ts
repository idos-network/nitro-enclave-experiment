import { searchForDuplicates } from "../providers/api.ts";
import { GROUP_NAME, FACETEC_DEVICE_KEY, MONGO_URI } from "../env.ts";
import { MongoClient } from "mongodb";

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

async function checkDuplicates() {
  console.log("Checking sessions vs 3d-db duplicates...");

  await client.connect();
  const database = await client.db("facetec-sdk-data");

  console.log("Connected to MongoDB, starting to check...");

  const cursor = database
    .collection("Session")
    .find(
      { success: true },
      { projection: { externalDatabaseRefID: 1, _id: 0 } }
    );

  let i = 0;
  let problematicUserId = new Set();

  for await (const { externalDatabaseRefID } of cursor) {
    try {
      if (i % 100 === 0) {
        console.log("Processed ", i, "users...");
      }

      i++;

      const searchResult = await searchForDuplicates(externalDatabaseRefID, FACETEC_DEVICE_KEY, GROUP_NAME, "curl");

      if (searchResult.success && searchResult.results.length > 1) {
        searchResult.results.forEach(item => {
          problematicUserId.add(item.identifier);
        })
      }
    } catch (err) {
      console.error(err);
    }
  }

  console.log("Search is complete: ", problematicUserId.size, "problematic userIds found.");
  console.log("Problematic user ids:", Array.from(problematicUserId).join(", "));
}

checkDuplicates();
