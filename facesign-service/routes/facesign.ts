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
  const generatedUserId: string = crypto.randomUUID();

  const { requestBlob } = req.body;

  // First check if liveness is proven
  const { success, result, responseBlob, didError, additionalSessionData } = await enrollment3d(
    generatedUserId,
    requestBlob,
    false, // We need face maps
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
    agent.writeLog("facesign-enrollment-failed", { success, result, didError });

    return res.status(400).json({
      ...alwaysToReturn,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
  }

  const { newUser, entropyToken, confirmationToken, faceSignUserId } = await faceSignLogin(
    generatedUserId,
    false,
  );

  return res.status(newUser ? 200 : 201).json({
    ...alwaysToReturn,
    faceSignUserId,
    newUser,
    entropyToken,
    confirmationToken,
  });
};

// FACESIGN - Confirmation route
export const confirmation = async (req: Request, res: Response) => {
  const { confirmationToken } = req.body;

  let result: { sub: string; action: string; iat: number };

  try {
    result = jwt.verify(confirmationToken, readFileSync(JWT_PRIVATE_KEY, "utf-8"), {
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

  const faceSignUserId = result.sub;

  // Check duplications (race-condition)
  const searchResult = await searchForDuplicates(faceSignUserId, FACE_SIGN_GROUP_NAME);
  if (!searchResult.success || searchResult.results.length > 0) {
    return res.status(409).json({ errorMessage: "User already exists" });
  }

  // Enroll user in 3d-db so they can be matched later
  await enrollUser(faceSignUserId, FACE_SIGN_GROUP_NAME);
  await insertMember(faceSignUserId, FACE_SIGN_GROUP_NAME);

  const entropyToken = jwt.sign(
    { sub: faceSignUserId },
    readFileSync(JWT_PRIVATE_KEY, "utf-8"),
    { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
  );

  agent.writeLog("facesign-user-confirmed", {
    userId: faceSignUserId,
    ip: req.ip,
  });

  return res.status(200).json({ faceSignUserId, entropyToken });
};
