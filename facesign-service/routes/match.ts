import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { match3d3d } from "../providers/api.ts";

export default async function handler(req: Request, res: Response) {
  const { requestBlob, userId, storeSelfie = false } = req.body;

  agent.writeLog("match-request", { userId, storeSelfie });

  const { success, result, responseBlob, didError, additionalSessionData } = await match3d3d({
    userId,
    requestBlob,
    storeSelfie,
  });

  // Always return required fields for SDK
  const alwaysToReturn = {
    success,
    responseBlob,
    didError,
    result,
    additionalSessionData,
  };

  if (!success || didError) {
    // Otherwise we are using FeatureFlag for max 5 attempts
    // so we should return failure status.
    agent.writeLog("match-3d-3d-failed", { success, result, userId });

    return res.status(400).json({
      ...alwaysToReturn,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
  }

  agent.writeLog("match-3d-3d-done", {
    identifier: userId,
    matchLevel: result.matchLevel,
    selfieImageId: storeSelfie ? userId : null,
  });

  return res.status(201).json({
    ...alwaysToReturn,
    // During matching, there is no enrollment record, only Reverification3D3D record
    selfieImageId: storeSelfie ? userId : null,
  });
}
