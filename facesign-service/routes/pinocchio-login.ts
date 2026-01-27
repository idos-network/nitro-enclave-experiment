import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import { JWT_PRIVATE_KEY, PINOCCHIO_GROUP_NAME } from "../env.ts";
import agent from "../providers/agent.ts";
import { enrollment3d, searchForDuplicates } from "../providers/api.ts";
import { countMembersInGroup, getOldestFaceSignUserId } from "../providers/db.ts";

// PINOCCHIO Login - Check if user exists and return token for existing users
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
    agent.writeLog("pinocchio-login-failed", {
      success,
      result,
      didError,
    });

    return res.status(400).json({
      ...alwaysToReturn,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
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

    console.log("Group does not exist yet, user needs to enroll first.");
    results = [];
  } else {
    throw new Error("Failed to search for duplicates, check application logs.");
  }

  const isNewUser = results.length === 0;

  if (isNewUser) {
    // New user - return early without enrolling, client should call /pinocchio/enroll
    agent.writeLog("pinocchio-login-new-user", {
      identifier: faceSignUserId,
    });

    return res.status(200).json({
      ...alwaysToReturn,
      isNewUser: true,
    });
  }

  // Existing user found
  agent.writeLog("pinocchio-login-existing-user", {
    identifiers: results.map((x) => x.identifier),
    count: results.length,
  });

  // Choose the "first" one (oldest one)
  const existingUserId = await getOldestFaceSignUserId(results.map((x) => x.identifier));

  // Issue JWT token
  const token = jwt.sign({ sub: existingUserId }, readFileSync(JWT_PRIVATE_KEY, "utf-8"), {
    algorithm: "ES512",
  });

  return res.status(201).json({
    ...alwaysToReturn,
    isNewUser: false,
    faceSignUserId: existingUserId,
    token,
  });
}
