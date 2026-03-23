import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { RELAY_JWT_PUBLIC_KEY_BASE_64 } from "../env.ts";

/**
 * Requires `Authorization: Bearer <jwt>` for `/relay/*` routes.
 * Tokens must be ES512 and verifiable with the PEM in env `RELAY_JWT_PUBLIC_KEY`.
 * Additionally, tokens must have an 'iat' (issued at) within the last 10 minutes.
 */
export const relayJwtAuthMiddleware: RequestHandler = (req, res, next) => {
  const publicPem = Buffer.from(RELAY_JWT_PUBLIC_KEY_BASE_64, "base64").toString("utf-8");

  if (!publicPem) {
    return res.status(503).json({
      errorMessage:
        "Relay JWT verification is not configured (set RELAY_JWT_PUBLIC_KEY to the PEM text).",
    });
  }

  const header = req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ errorMessage: "Missing or invalid Authorization header." });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ errorMessage: "Missing bearer token." });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, publicPem, { algorithms: ["ES512"] });
  } catch {
    return res.status(401).json({ errorMessage: "Invalid or expired bearer token." });
  }

  if (!decoded || typeof decoded.iat !== "number") {
    return res.status(401).json({ errorMessage: "Token missing issued at (iat) claim." });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const maxAgeSec = 10 * 60; // 10 minutes
  if (nowSec - decoded.iat > maxAgeSec) {
    return res.status(401).json({ errorMessage: "Bearer token is too old." });
  }

  next();
};
