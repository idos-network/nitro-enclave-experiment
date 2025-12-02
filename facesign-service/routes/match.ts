import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { match3d3d } from "../providers/api.ts";

export default async function handler(req: Request, res: Response) {
  const { faceScan, externalUserId } = req.body;

  try {
    // First check if liveness is proven
    const { success, result, responseBlob, didError } = await match3d3d(externalUserId, faceScan);

    // If there is "just" a response blob, we should return it to client
    // this is used when session starts or it's wrong image.
    // This looks like a replacement of the previous "challenge" mechanism.
    if (responseBlob && success === undefined) {
      agent.writeLog("match-response-blob", {});

      return res.status(200).json({
        responseBlob,
      });
    }

    // Always return required fields for SDK
    const alwaysToReturn = {
      success,
      responseBlob,
      didError,
      result,
    };

    if (!success || !result.livenessProven) {
      agent.writeLog("match-3d-3d-failed", { success, result, externalUserId });
    } else {
      agent.writeLog("match-3d-3d-done", {
        identifier: externalUserId,
        matchLevel: result.matchLevel,
      });
    }

    return res.status(200).json(alwaysToReturn);
  } catch (error) {
    if (!(error instanceof Error)) {
      agent.writeLog("match-error", { message: "Unknown error in /match", error });
    } else {
      agent.writeLog("match-error", { message: error.message, stack: error.stack });
    }

    return res.status(500).json({
      success: false,
      didError: true,
      error: true,
      errorMessage: "Match process failed, check server logs.",
    });
  }
}
