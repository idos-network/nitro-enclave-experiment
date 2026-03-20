import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { match3d2dId } from "../providers/api.ts";

export default async function handler(req: Request, res: Response) {
  const { image, externalUserId, minMatchLevel = 7 } = req.body;

  agent.writeLog("match-id-request", { externalUserId, minMatchLevel });

  const response = await match3d2dId(externalUserId, image, minMatchLevel);

  return res.status(201).json(response);
}
