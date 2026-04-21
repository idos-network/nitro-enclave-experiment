import { MongoClient } from "mongodb";
import { FACE_SIGN_GROUP_NAME, MONGO_URI } from "../env.ts";
import { searchForDuplicates } from "../providers/api.ts";

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

interface CheckDuplicatesOptions {
  groupName: string;
  minMatchLevel: number;
}

function getCheckDuplicatesOptions(): CheckDuplicatesOptions {
  const [groupNameArg, minMatchLevelArg] = process.argv.slice(2);
  const groupName = groupNameArg?.trim() || FACE_SIGN_GROUP_NAME;
  const minMatchLevel = minMatchLevelArg ? Number(minMatchLevelArg) : 15;

  if (!Number.isFinite(minMatchLevel)) {
    throw new Error("`minMatchLevel` must be a valid number.");
  }

  return {
    groupName,
    minMatchLevel,
  };
}

async function checkDuplicates({
  groupName,
  minMatchLevel,
}: CheckDuplicatesOptions): Promise<void> {
  console.log("Checking sessions vs 3d-db duplicates...");

  await client.connect();
  const database = await client.db("facetec-sdk-data");

  console.log(
    `Connected to MongoDB, starting to check group "${groupName}" with minMatchLevel ${minMatchLevel}...`,
  );

  const cursor = database
    .collection("Session")
    .find({ success: true }, { projection: { externalDatabaseRefID: 1, _id: 0 } });

  let i = 0;
  const problematicUserId = new Set<string>();

  for await (const { externalDatabaseRefID } of cursor) {
    try {
      if (i % 100 === 0) {
        console.log("Processed ", i, "users...");
      }

      i++;

      const searchResult = await searchForDuplicates({
        userId: externalDatabaseRefID,
        groupName,
        minMatchLevel,
      });

      if (searchResult.success && searchResult.results.length > 1) {
        searchResult.results.forEach((item) => {
          problematicUserId.add(item.identifier);
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  console.log("Search is complete: ", problematicUserId.size, "problematic userIds found.");
  console.log("Problematic user ids:", Array.from(problematicUserId).join(", "));
}

checkDuplicates(getCheckDuplicatesOptions()).catch((err) => {
  console.error("Fatal error while checking duplicates:", err);
  process.exit(1);
});
