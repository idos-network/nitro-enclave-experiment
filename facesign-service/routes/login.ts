import crypto from "node:crypto";
import type { Request, Response } from "express";
import { GROUP_NAME } from "../env.ts";
import agent from "../providers/agent.ts";
import { enrollment3d, enrollUser, searchForDuplicates } from "../providers/api.ts";
import { countMembersInGroup, insertMember } from "../providers/db.ts";
import { faceSignLogin } from "../providers/facesign.ts";

export default async function handler(req: Request, res: Response) {
  let faceSignUserId: string = crypto.randomUUID();

  const {
    requestBlob,
    groupName = GROUP_NAME,
    faceVector = true,
    onboardFaceSignWallet = false,
  } = req.body;

  if (faceVector && onboardFaceSignWallet) {
    throw new Error("Cannot request face vector and onboard to FaceSign Wallet at the same time.");
  }

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
    additionalSessionData, // This can be used for POU credentials
    result,
  };

  if (!success || !result.livenessProven || didError) {
    agent.writeLog("login-enrollment-failed", { success, result, didError });

    return res.status(400).json({
      ...alwaysToReturn,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
  }

  // Search for 3d-db duplicates
  let results: { identifier: string; matchLevel: number }[] = [];

  const searchResult = await searchForDuplicates(faceSignUserId, groupName);

  if (searchResult.success) {
    results = searchResult.results;
  } else if (
    searchResult.error &&
    searchResult.errorMessage?.includes("groupName when that groupName does not exist")
  ) {
    // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
    const memberCount = await countMembersInGroup(groupName);
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
    agent.writeLog("login-new-user", {
      identifier: faceSignUserId,
      groupName,
    });
    await enrollUser(faceSignUserId, groupName);
    await insertMember(groupName, faceSignUserId);
  } else if (results.length > 1) {
    agent.writeLog("login-duplicate-error", {
      identifiers: results.map((x) => x.identifier),
      count: results.length,
      groupName,
    });

    return res.status(409).json({
      ...alwaysToReturn,
      errorMessage:
        "Login process failed, check server logs: Multiple users found with the same face-vector.",
    });
  } else {
    agent.writeLog("login-duplicate", {
      identifiers: results.map((x) => x.identifier),
      count: results.length,
      groupName,
    });
    // biome-ignore lint/style/noNonNullAssertion: This is safe because we check results.length > 1
    // biome-ignore lint/suspicious/noNonNullAssertedOptionalChain: This is safe because we check results.length > 1
    faceSignUserId = results[0]?.identifier!;
  }

  let faceSign: {
    newUser: boolean;
    faceSignUserId: string;
    entropyToken?: string | undefined;
  } | null = null;

  // If we want token and onboard user in facesign wallet group
  if (onboardFaceSignWallet) {
    const {
      newUser: walletNewUser,
      faceSignUserId: walletUserId,
      entropyToken,
    } = await faceSignLogin(
      faceSignUserId,
      true, // Enroll if new, we want the user to be enrolled in facesign-users group, there is no confirmation
    );

    faceSign = {
      newUser: walletNewUser,
      faceSignUserId: walletUserId,
      entropyToken,
    };
  }

  return res.status(201).json({
    ...alwaysToReturn,
    faceSignUserId,

    // In case of onboarding to FaceSignWallet
    faceSign,
  });
}
