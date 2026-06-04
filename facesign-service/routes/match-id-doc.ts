import type { Request, Response } from "express";
import { match3d2dId } from "../providers/api.ts";
import { writeLog } from "../utils/logger-context.ts";

export default async function handler(req: Request, res: Response) {
  const { image, userId, minMatchLevel = 7 } = req.body;

  writeLog("match_id_request", { userId, minMatchLevel });

  const response = await match3d2dId({ userId, image, minMatchLevel });

  return res.status(201).json(response);
}
