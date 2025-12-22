import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import { JWT_PRIVATE_KEY, PINOCCHIO_GROUP_NAME } from "../env.ts";
import agent from "../providers/agent.ts";
import { convertToFaceVector, enrollment3d, enrollUser, searchForDuplicates } from "../providers/api.ts";
import { countMembersInGroup, getOldestFaceSignUserId, insertMember } from "../providers/db.ts";

// PINOCCHIO 3D Login
export default async function handler(req: Request, res: Response) {
  let faceSignUserId: string = crypto.randomUUID();

  const { requestBlob, faceVector = false } = req.body;

  // First check if liveness is proven
  const { success, result, responseBlob, didError, additionalSessionData } = await enrollment3d(
    faceSignUserId,
    requestBlob,
  );

  // Always return required fields for SDK
  const alwaysToReturn = {
    success,
    responseBlob,
    didError,
    result,
    additionalSessionData,
  };

  if (!success || !result.livenessProven || didError) {
    agent.writeLog("pinocchio-enrollment-failed", { success, result, didError });

    return res.status(400).json({
      ...alwaysToReturn,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
  }

  if (faceVector) {
    agent.writeLog("login-face-vector-convert", { identifier: faceSignUserId });
    await convertToFaceVector(faceSignUserId);
  }

  // Search for 3d-db duplicates
  let results: { identifier: string; matchLevel: number }[] = [];

  const searchResult = await searchForDuplicates(faceSignUserId, PINOCCHIO_GROUP_NAME);

  if (searchResult.success) {
    results = searchResult.results;
  } else if (
    searchResult.error &&
    searchResult.errorMessage?.includes("groupName when that groupName does not exist")
  ) {
    // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
    const memberCount = await countMembersInGroup(PINOCCHIO_GROUP_NAME);
    if (memberCount > 0) {
      throw new Error("Group exists in our DB, but not in 3d-db, this should never happen.");
    }

    console.log("Group does not exist, creating one by enrolling first user.");
    results = [];
  } else {
    throw new Error("Failed to search for duplicates, check application logs.");
  }

  const newUser = results.length === 0;

  if (newUser) {
    // Brand new user, let's enroll in 3d-db#users
    agent.writeLog("pinocchio-new-user", { identifier: faceSignUserId });

    await enrollUser(faceSignUserId, PINOCCHIO_GROUP_NAME);
    await insertMember(PINOCCHIO_GROUP_NAME, faceSignUserId);
  } else {
    // This is a difference from normal /login route
    agent.writeLog("pinocchio-duplicate", {
      identifiers: results.map((x) => x.identifier),
      count: results.length,
    });

    // Choose the "first" one (oldest one)
    // TODO: Check this ...
    faceSignUserId = await getOldestFaceSignUserId(results.map((x) => x.identifier));
  }

  // Issue JWT token
  const token = jwt.sign(
    { sub: faceSignUserId },
    readFileSync(JWT_PRIVATE_KEY, "utf-8"),
    { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
  );

  return res.status(201).json({
    ...alwaysToReturn,
    faceSignUserId,
    token,
  });
}
