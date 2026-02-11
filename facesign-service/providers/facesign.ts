import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { FACE_SIGN_GROUP_NAME, JWT_PRIVATE_KEY } from "../env.ts";
import agent from "../providers/agent.ts";
import { enrollUser, searchForDuplicates } from "./api.ts";
import { countMembersInGroup, getOldestFaceSignUserId, insertMember } from "./db.ts";

// FaceSign login - new user (waiting for confirmation)
export interface FaceSignLoginNew {
  newUser: true;
  faceSignUserId: string;
  newUserConfirmationToken: string;
}

// FaceSign login (via normal login route, forced onboarding)
export interface FaceSignLoginCreated {
  newUser: true;
  faceSignUserId: string;
  userAttestmentToken: string;
}

// FaceSign login (existing user)
export interface FaceSignLoginExisting {
  newUser: false;
  faceSignUserId: string;
  userAttestmentToken: string;
}

/**
 * FaceSign Login process
 * @param faceSignUserId Onboarded users, liveness proven, no error
 */
export async function faceSignLogin(
  currentUserId: string,
  enrollIfNew = false,
): Promise<FaceSignLoginNew | FaceSignLoginExisting | FaceSignLoginCreated> {
  let results: { identifier: string; matchLevel: number }[] = [];

  const searchResult = await searchForDuplicates(currentUserId, FACE_SIGN_GROUP_NAME);

  if (searchResult.success) {
    results = searchResult.results;
  } else if (
    searchResult.error &&
    searchResult.errorMessage?.includes("groupName when that groupName does not exist")
  ) {
    // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
    const memberCount = await countMembersInGroup(FACE_SIGN_GROUP_NAME);
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
    const newUserConfirmationToken = jwt.sign(
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
      newUserConfirmationToken,
    };
  }

  // Existing user, we can provide an entropy token for key
  if (results.length > 0) {
    // This is a difference from normal /login route
    agent.writeLog("facesign-duplicate", {
      identifiers: results.map((x) => x.identifier),
      currentUserId,
      count: results.length,
    });

    let faceSignUserId = results[0]?.identifier;

    // For more than 1 result (FFRs), we take the oldest one (the one that was onboarded first)
    if (results.length > 1) {
      faceSignUserId = await getOldestFaceSignUserId(results.map((x) => x.identifier));
    }

    const userAttestmentToken = jwt.sign(
      { sub: faceSignUserId },
      readFileSync(JWT_PRIVATE_KEY, "utf-8"),
      { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
    );

    return {
      newUser: false,
      userAttestmentToken,
      // @ts-expect-error Missing types, but it should be fine with the check above
      faceSignUserId,
    };
  }

  // New user, enroll and onboard
  agent.writeLog("facesign-new-user", { identifier: currentUserId });

  await enrollUser(currentUserId, FACE_SIGN_GROUP_NAME);
  await insertMember(FACE_SIGN_GROUP_NAME, currentUserId);

  const userAttestmentToken = jwt.sign(
    { sub: currentUserId },
    readFileSync(JWT_PRIVATE_KEY, "utf-8"),
    {
      algorithm: "ES512",
      expiresIn: "20s",
    },
  );

  return {
    newUser: true,
    userAttestmentToken,
    faceSignUserId: currentUserId,
  };
}
