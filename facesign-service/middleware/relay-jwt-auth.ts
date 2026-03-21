import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { RELAY_JWT_PUBLIC_KEY } from "../env.ts";

/**
 * Requires `Authorization: Bearer <jwt>` for `/relay/*` routes.
 * Tokens must be ES512 and verifiable with the PEM in env `RELAY_JWT_PUBLIC_KEY`.
 */
export const relayJwtAuthMiddleware: RequestHandler = (req, res, next) => {
  const publicPem = RELAY_JWT_PUBLIC_KEY;

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

  try {
    jwt.verify(token, publicPem, { algorithms: ["ES512"] });
  } catch {
    return res.status(401).json({ errorMessage: "Invalid or expired bearer token." });
  }

  next();
};
