import crypto from "node:crypto";
import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { type Enrollment3DResponseData, enrollment3d } from "../providers/api.ts";
import {
  type FaceSignLoginCreated,
  type FaceSignLoginExisting,
  type FaceSignLoginNew,
  faceSignLogin,
} from "../providers/facesign.ts";

export interface LivenessRequestData {
  requestBlob: string;
  faceVector?: boolean;
  onboardFaceSign?: boolean;
  storeSelfie?: boolean;
}

export interface LivenessResponseData extends Enrollment3DResponseData {
  userId?: string;
  faceSign?: FaceSignLoginNew | FaceSignLoginExisting | FaceSignLoginCreated;
  selfieFileId?: string;
}

export default async function handler(req: Request, res: Response) {
  const userId: string = crypto.randomUUID();

  const { requestBlob, faceVector = true, onboardFaceSign = false, storeSelfie = false } = req.body;

  agent.writeLog("liveness-request", {
    userId,
    faceVector,
    onboardFaceSign,
    storeSelfie,
  });

  if (faceVector && onboardFaceSign) {
    throw new Error("Cannot request face vector and onboard to FaceSign at the same time.");
  }

  // First check if liveness is proven
  const { success, result, responseBlob, didError, additionalSessionData, launchId } =
    await enrollment3d({ userId, requestBlob, faceVector, storeSelfie });

  // Always return required fields for SDK
  const response: LivenessResponseData = {
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
    response.selfieFileId = userId;
  }

  // If we want token and onboard user in facesign group
  if (onboardFaceSign) {
    const faceSignLoginResult = await faceSignLogin({
      userId,
      launchId,
      enrollIfNew: true, // Enroll if new, we want the user to be enrolled in pinocchio-users group, there is no confirmation
    });

    response.faceSign = faceSignLoginResult;
  }

  return res.status(201).json(response);
}
