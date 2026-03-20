import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { getAuditTrailImage } from "../providers/db.ts";

export default async function selfie(req: Request, res: Response) {
  const { selfieId } = req.params;

  if (!selfieId) {
    return res.status(400).json({
      errorMessage: "Selfie ID is required.",
    });
  }

  agent.writeLog("selfie-request", { selfieId });

  // We can't use FacetecAPI, because match is not doing an enrollment
  // and there is no API for facetec to get match-3d-3d.

  const imageBuffer = await getAuditTrailImage(selfieId);

  if (!imageBuffer) {
    agent.writeLog("selfie-failed", {
      selfieId,
      error: `No selfie image found for ${selfieId}`,
    });

    return res.status(404).json({
      errorMessage: "Selfie image not found.",
    });
  }

  return res.status(200).contentType("image/jpeg").send(imageBuffer);
}
