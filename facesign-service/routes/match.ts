import type { Request, Response } from "express";
import { match3d3d } from "../providers/api.ts";
import { writeLog } from "../utils/logger-context.ts";

export default async function handler(req: Request, res: Response) {
  const { requestBlob, userId, storeSelfie = false } = req.body;

  writeLog("match_request", { userId, storeSelfie });

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
    writeLog("match_3d_3d_failed", { success, result, userId });

    return res.status(400).json({
      ...alwaysToReturn,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
  }

  writeLog("match_3d_3d_done", {
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
