import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { match3d3d } from "../providers/api.ts";

export default async function handler(req: Request, res: Response) {
  const { requestBlob, externalUserId } = req.body;

  const { success, result, responseBlob, didError } = await match3d3d(externalUserId, requestBlob);

  // Always return required fields for SDK
  const alwaysToReturn = {
    success,
    responseBlob,
    didError,
    result,
  };

  if (!success || !result.livenessProven) {
    agent.writeLog("match-3d-3d-failed", { success, result, externalUserId });

    return res.status(400).json({
      ...alwaysToReturn,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
  }

  agent.writeLog("match-3d-3d-done", {
    identifier: externalUserId,
    matchLevel: result.matchLevel,
  });

  return res.status(200).json(alwaysToReturn);
}
