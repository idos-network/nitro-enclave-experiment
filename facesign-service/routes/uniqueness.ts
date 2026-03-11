import crypto from "node:crypto";
import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { enrollment3d } from "../providers/api.ts";
import { InternalServerError } from "../providers/errors.ts";
import { faceSignLogin } from "../providers/facesign.ts";
import { findOrEnrollInGroup } from "../providers/groups.ts";
import type { LivenessRequestData, LivenessResponseData } from "./liveness.ts";

export interface UniquenessRequestData extends LivenessRequestData {
  groupName: string;
}

// Those are the same 1:1
export interface UniquenessResponseData extends LivenessResponseData {}

export default async function handler(req: Request, res: Response) {
  const userId: string = crypto.randomUUID();

  // Audit trail image will be stored in the current enrollment
  // we can't use userId because it can change during the dedup process.
  const selfieFileId = userId;

  const {
    requestBlob,
    groupName,
    faceVector = true,
    onboardFaceSign = false,
    storeSelfie = false,
  } = req.body;

  agent.writeLog("uniqueness-request", {
    userId,
    groupName,
    faceVector,
    onboardFaceSign,
    storeSelfie,
  });

  if (faceVector && onboardFaceSign) {
    throw new Error("Cannot request face vector and onboard to FaceSign at the same time.");
  }

  if (!groupName) {
    throw new Error("Group name is required.");
  }

  // First check if liveness is proven
  const { success, result, responseBlob, didError, additionalSessionData, launchId } =
    await enrollment3d({ userId, requestBlob, faceVector, storeSelfie });

  // Always return required fields for SDK
  const response: UniquenessResponseData = {
    success,
    responseBlob,
    didError,
    additionalSessionData, // This can be used for POU credentials
    result,
    userId,
  };

  // If the user is already enrolled, we will return a different
  // userId, which can't be used to get the audit trail image.
  if (storeSelfie) {
    response.selfieFileId = selfieFileId;
  }

  const { groupUserId, newUser } = await findOrEnrollInGroup({
    userId,
    groupName,
    launchId,
    process: "uniqueness",
    enrollIfNew: true,
  });

  if (!newUser) {
    response.userId = groupUserId;
  }

  if (!response.userId) {
    throw new InternalServerError("User not found after deduplication, this should never happen.");
  }

  // If we want token and onboard user in facesign group
  if (onboardFaceSign) {
    const faceSignLoginResult = await faceSignLogin({
      userId: response.userId,
      launchId,
      enrollIfNew: true, // Enroll if new, we want the user to be enrolled in facesign-users group, there is no confirmation
    });

    response.faceSign = faceSignLoginResult;
  }

  return res.status(201).json(response);
}
