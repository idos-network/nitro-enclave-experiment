import type { Request, Response } from "express";
import agent from "../providers/agent.ts";
import { match3d2dId } from "../providers/api.ts";

export default async function handler(req: Request, res: Response) {
  const { image, userId, minMatchLevel = 7 } = req.body;

  agent.writeLog("match-id-request", { userId, minMatchLevel });

  const response = await match3d2dId({ userId, image, minMatchLevel });

  return res.status(201).json(response);
}
