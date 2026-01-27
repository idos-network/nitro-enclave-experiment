import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import { JWT_PRIVATE_KEY, PINOCCHIO_GROUP_NAME } from "../env.ts";
import agent from "../providers/agent.ts";
import { enrollment3d, enrollUser, searchForDuplicates } from "../providers/api.ts";
import { countMembersInGroup, getOldestFaceSignUserId, insertMember } from "../providers/db.ts";

// PINOCCHIO Enroll - Enroll a new user
export default async function handler(req: Request, res: Response) {
  const faceSignUserId: string = crypto.randomUUID();

  const { requestBlob, faceVector = false } = req.body;

  // First check if liveness is proven
  const { success, result, responseBlob, didError, additionalSessionData } = await enrollment3d(
    faceSignUserId,
    requestBlob,
    faceVector,
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
    agent.writeLog("pinocchio-enroll-failed", {
      success,
      result,
      didError,
    });

    return res.status(400).json({
      ...alwaysToReturn,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
  }

  // Search for 3d-db duplicates to check if user already exists
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

  const isNewUser = results.length === 0;

  if (!isNewUser) {
    // User already exists - return their existing ID and token
    agent.writeLog("pinocchio-enroll-existing-user", {
      identifiers: results.map((x) => x.identifier),
      count: results.length,
    });

    const existingUserId = await getOldestFaceSignUserId(results.map((x) => x.identifier));

    const token = jwt.sign({ sub: existingUserId }, readFileSync(JWT_PRIVATE_KEY, "utf-8"), {
      algorithm: "ES512",
    });

    return res.status(200).json({
      ...alwaysToReturn,
      isNewUser: false,
      faceSignUserId: existingUserId,
      token,
    });
  }

  // Brand new user - enroll in 3d-db
  agent.writeLog("pinocchio-enroll-new-user", { identifier: faceSignUserId });

  await enrollUser(faceSignUserId, PINOCCHIO_GROUP_NAME);
  await insertMember(PINOCCHIO_GROUP_NAME, faceSignUserId);

  // Issue JWT token
  const token = jwt.sign({ sub: faceSignUserId }, readFileSync(JWT_PRIVATE_KEY, "utf-8"), {
    algorithm: "ES512",
  });

  return res.status(201).json({
    ...alwaysToReturn,
    isNewUser: true,
    faceSignUserId,
    token,
  });
}
