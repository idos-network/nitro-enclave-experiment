import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { FACE_SIGN_GROUP_NAME, JWT_PRIVATE_KEY } from "../env.ts";
import agent from "../providers/agent.ts";
import { findOrEnrollInGroup } from "./groups.ts";

// FaceSign login - new user (waiting for confirmation)
export interface FaceSignLoginNew {
  newUser: true;
  userId: string;
  newUserConfirmationToken: string;
}

// FaceSign login (via normal login route, forced onboarding)
export interface FaceSignLoginCreated {
  newUser: true;
  userId: string;
  userAttestmentToken: string;
}

// FaceSign login (existing user)
export interface FaceSignLoginExisting {
  newUser: false;
  userId: string;
  userAttestmentToken: string;
}

/**
 * FaceSign Login process
 * @param userId Onboarded users, liveness proven, no error
 */
export async function faceSignLogin({
  userId,
  launchId,
  enrollIfNew = false,
}: {
  userId: string;
  launchId: string;
  enrollIfNew: boolean;
}): Promise<FaceSignLoginNew | FaceSignLoginExisting | FaceSignLoginCreated> {
  const { groupUserId, newUser } = await findOrEnrollInGroup({
    userId,
    groupName: FACE_SIGN_GROUP_NAME,
    launchId,
    process: "facesign",
    enrollIfNew,
    minMatchLevel: 15,
  });

  // New user but not enrolled yet
  if (newUser && !enrollIfNew) {
    const newUserConfirmationToken = jwt.sign(
      { sub: groupUserId, action: "confirmation" },
      readFileSync(JWT_PRIVATE_KEY, "utf-8"),
      { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
    );

    agent.writeLog("facesign-user-pending-confirmation", {
      userId: groupUserId,
      launchId,
    });

    return {
      newUser: true,
      userId: groupUserId,
      newUserConfirmationToken,
    };
  }

  const userAttestmentToken = jwt.sign(
    { sub: groupUserId },
    readFileSync(JWT_PRIVATE_KEY, "utf-8"),
    { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
  );

  return {
    newUser: newUser,
    userAttestmentToken,
    userId: groupUserId,
  } as FaceSignLoginCreated | FaceSignLoginExisting;
}
