import type { Request, Response } from "express";
import { match3d3d } from "../providers/api.ts";
import agent from "../providers/agent.ts";

export default async function handler(req: Request, res: Response) {
  const {
    faceScan,
    key,
    userAgent,
    auditTrailImage,
    lowQualityAuditTrailImage,
    sessionId,
    externalUserId,
  } = req.body;

  try {
    // First check if liveness is proven
    const {
      success,
      livenessProven,
      matchLevel,
    } = await match3d3d(
      externalUserId,
      faceScan,
    );

    if (!success || !livenessProven) {
      agent.writeLog("match-3d-3d-failed", { success, livenessProven, externalUserId });
    } else {
      agent.writeLog("match-3d-3d-done", {
        identifier: externalUserId,
        matchLevel,
      });
    }

    return res.status(200).json({
      // Success can be false even if wasProcessed is true (e.g. failed match)
      success,
      // We have to differentiate between failed match and failed liveness
      // in the UI we want user to repeat liveness check if this fails
      livenessProven,
      error: false,
      // 0-15
      matchLevel,
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      agent.writeLog("match-error", { message: "Unknown error in /match", error });
    } else {
      agent.writeLog("match-error", { message: error.message, stack: error.stack });
    }

    return res.status(500).json({
      success: false,
      message: "Match process failed, check server logs.",
    });
  }
}
