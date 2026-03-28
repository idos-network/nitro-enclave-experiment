import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { deleteAuditTrailImage, getAuditTrailImage } from "../providers/db.ts";

export async function handleGetAuditTrailImage(req: Request, res: Response) {
  const { externalDatabaseRefID } = req.params;

  if (!externalDatabaseRefID) {
    return res.status(400).json({
      errorMessage: "External database reference ID is required.",
    });
  }

  agent.writeLog("audit-trail-image-request", { externalDatabaseRefID });

  // We can't use FacetecAPI, because match is not doing an enrollment
  // and there is no API for facetec to get match-3d-3d.

  const imageBuffer = await getAuditTrailImage(externalDatabaseRefID);

  if (!imageBuffer) {
    agent.writeLog("selfie-failed", {
      externalDatabaseRefID,
      error: `No audit trail images found for ${externalDatabaseRefID}`,
    });

    return res.status(400).json({
      errorMessage: "Failed to get selfie.",
    });
  }

  return res.status(200).contentType("image/jpeg").send(imageBuffer);
}

export async function handleDeleteAuditTrailImage(req: Request, res: Response) {
  const { externalDatabaseRefID } = req.params;

  if (!externalDatabaseRefID) {
    return res.status(400).json({
      errorMessage: "External database reference ID is required.",
    });
  }

  agent.writeLog("delete-audit-trail-image-request", { externalDatabaseRefID });

  await deleteAuditTrailImage(externalDatabaseRefID);

  return res.status(201).json({ message: "Audit trail image deleted successfully." });
}
