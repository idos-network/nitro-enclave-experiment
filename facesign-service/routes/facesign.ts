import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import { FACE_SIGN_GROUP_NAME, JWT_PRIVATE_KEY } from "../env.ts";
import agent from "../providers/agent.ts";
import { enrollment3d, enrollUser, searchForDuplicates } from "../providers/api.ts";
import { insertMember } from "../providers/db.ts";
import { faceSignLogin } from "../providers/facesign.ts";

// FACESIGN - Login route
export const login = async (req: Request, res: Response) => {
  const userId: string = crypto.randomUUID();

  agent.writeLog("facesign-login", { userId });

  const { requestBlob } = req.body;

  // First check if liveness is proven
  const { success, result, responseBlob, didError, additionalSessionData, launchId } =
    await enrollment3d({
      userId,
      requestBlob,
      faceVector: false, // FaceSign DB has face maps
      storeSelfie: false, // There is no selfie to be exported
    });

  // Always return required fields for SDK
  const alwaysToReturn = {
    success,
    responseBlob,
    didError,
    result,
    additionalSessionData,
  };

  const faceSignLoginResult = await faceSignLogin({ userId, launchId, enrollIfNew: false });

  return res.status(faceSignLoginResult.newUser ? 200 : 201).json({
    ...alwaysToReturn,
    ...faceSignLoginResult,
  });
};

// FACESIGN - Confirmation route
export const confirmation = async (req: Request, res: Response) => {
  const { newUserConfirmationToken } = req.body;

  let result: { sub: string; action: string; iat: number };

  try {
    result = jwt.verify(newUserConfirmationToken, readFileSync(JWT_PRIVATE_KEY, "utf-8"), {
      algorithms: ["ES512"],
    }) as { sub: string; action: string; iat: number };
  } catch (error) {
    // biome-ignore lint/suspicious/noExplicitAny: Need to access error message
    agent.writeLog("jwt-verify-error", { error: (error as any)?.message });
    return res.status(400).json({ errorMessage: "Invalid or expired token" });
  }

  if (!result.iat || !result.sub || result.action !== "confirmation") {
    agent.writeLog("facesign-confirmation-error-validate", {
      message: "Token missing iat or sub",
    });

    return res.status(400).json({ errorMessage: "Token has not valid format" });
  }

  if (Date.now() / 1000 - result.iat > 1 * 60) {
    agent.writeLog("facesign-confirmation-error-iat", {
      message: "Token is too old",
      iat: result.iat,
      now: Date.now() / 1000,
    });
    return res.status(400).json({ errorMessage: "Token already expired" });
  }

  const userId = result.sub;

  // Check duplications (race-condition, minMatchLevel = 15 because facesign only allows minMatchLevel = 15)
  const searchResult = await searchForDuplicates({
    userId,
    groupName: FACE_SIGN_GROUP_NAME,
    minMatchLevel: 15,
  });
  if (!searchResult.success || searchResult.results.length > 0) {
    return res.status(409).json({ errorMessage: "User already exists" });
  }

  // Enroll user in 3d-db so they can be matched later
  await enrollUser({ userId, groupName: FACE_SIGN_GROUP_NAME });
  await insertMember({ groupName: FACE_SIGN_GROUP_NAME, userId });

  const userAttestmentToken = jwt.sign(
    { sub: userId },
    readFileSync(JWT_PRIVATE_KEY, "utf-8"),
    { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
  );

  agent.writeLog("facesign-user-confirmed", {
    userId,
    ip: req.ip,
  });

  return res.status(200).json({ userId, userAttestmentToken });
};
