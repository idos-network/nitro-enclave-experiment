import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { FACESIGN_WALLET_GROUP_NAME, JWT_PRIVATE_KEY } from "../env.ts";
import agent from "../providers/agent.ts";
import { enrollUser, searchForDuplicates } from "./api.ts";
import { countMembersInGroup, getOldestFaceSignUserId, insertMember } from "./db.ts";

/**
 * FaceSign Wallet Login process
 * @param faceSignUserId Onboarded users, liveness proven, no error
 */
export async function faceSignLogin(
  currentUserId: string,
  enrollIfNew = false,
): Promise<{
  newUser: boolean;
  faceSignUserId: string;
  entropyToken?: string;
  confirmationToken?: string;
}> {
  let results: { identifier: string; matchLevel: number }[] = [];

  const searchResult = await searchForDuplicates(currentUserId, FACESIGN_WALLET_GROUP_NAME);

  if (searchResult.success) {
    results = searchResult.results;
  } else if (
    searchResult.error &&
    searchResult.errorMessage?.includes("groupName when that groupName does not exist")
  ) {
    // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
    const memberCount = await countMembersInGroup(FACESIGN_WALLET_GROUP_NAME);
    if (memberCount > 0) {
      throw new Error("Group exists in our DB, but not in 3d-db, this should never happen.");
    }

    console.log("Group does not exist, creating one by enrolling first user.");
    results = [];
  } else {
    throw new Error("Failed to search for duplicates, check application logs.");
  }

  // New user, but it should not be enrolled yet
  if (results.length === 0 && !enrollIfNew) {
    const confirmationToken = jwt.sign(
      { sub: currentUserId, action: "confirmation" },
      readFileSync(JWT_PRIVATE_KEY, "utf-8"),
      { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
    );

    agent.writeLog("facesign-user-pending-confirmation", {
      faceSignUserId: currentUserId,
    });

    return {
      newUser: true,
      faceSignUserId: currentUserId,
      confirmationToken,
    };
  }

  // Existing user, we can provide an entropy token for key in wallet
  if (results.length > 0) {
    // This is a difference from normal /login route
    agent.writeLog("facesign-duplicate", {
      identifiers: results.map((x) => x.identifier),
      currentUserId,
      count: results.length,
    });

    let faceSignUserId = results[0]?.identifier;

    // For more than 1 result (should not happen), we take the oldest one (the one that was onboarded first)
    if (results.length > 1) {
      faceSignUserId = await getOldestFaceSignUserId(results.map((x) => x.identifier));
    }

    const entropyToken = jwt.sign(
      { sub: faceSignUserId },
      readFileSync(JWT_PRIVATE_KEY, "utf-8"),
      { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
    );

    return {
      newUser: false,
      entropyToken,
      // @ts-expect-error Missing types, but it should be fine with the check above
      faceSignUserId,
    };
  }

  // New user, enroll and onboard
  agent.writeLog("facesign-new-user", { identifier: currentUserId });

  await enrollUser(currentUserId, FACESIGN_WALLET_GROUP_NAME);
  await insertMember(FACESIGN_WALLET_GROUP_NAME, currentUserId);

  const token = jwt.sign({ sub: currentUserId }, readFileSync(JWT_PRIVATE_KEY, "utf-8"), {
    algorithm: "ES512",
    expiresIn: "20s",
  });

  return {
    newUser: true,
    entropyToken: token,
    faceSignUserId: currentUserId,
  };
}
