import { readFileSync } from "node:fs";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { JWT_PUBLIC_KEY } from "../env.ts";

export interface JwtPayload {
  sub: string;
  purpose?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function verifyEnrollmentToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      errorMessage: "Missing or invalid Authorization header",
    });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, readFileSync(JWT_PUBLIC_KEY, "utf-8"), {
      algorithms: ["ES512"],
    }) as JwtPayload;

    if (decoded.purpose !== "enrollment_confirmation") {
      return res.status(401).json({
        success: false,
        errorMessage: "Invalid token purpose",
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        errorMessage: "Token has expired",
      });
    }

    return res.status(401).json({
      success: false,
      errorMessage: "Invalid token",
    });
  }
}
