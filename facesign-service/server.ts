import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";

import { FACETEC_PUBLIC_KEY_PATH, GROUP_NAME, HOST, JWT_PRIVATE_KEY, KEY_1_MULTIBASE_PUBLIC_PATH } from "./env.ts";
import agent from "./providers/agent.ts";
import { enrollment3d, enrollUser, getSessionToken, searchForDuplicates } from "./providers/api.ts";
import { countMembersInGroup, insertMember } from "./providers/db.ts";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));

app.get("/", (_req, res) => {
  res.json({ message: "FaceSign Service is running" });
});

// Session-Token
app.post("/session-token", async (req, res) => {
  try {
    const sessionToken = await getSessionToken(req.body.key, req.body.deviceIdentifier);
    agent.writeLog("session-token", {
      deviceIdentifier: req.body.deviceIdentifier,
    });
    return res.status(200).json({ success: true, sessionToken });
  } catch (error) {
    if (!(error instanceof Error)) {
      agent.writeLog("error", {
        message: "Unknown error in /session-token",
        error,
      });
    } else {
      agent.writeLog("error", { message: error.message, stack: error.stack });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to get session token, check server logs.",
    });
  }
});

// Login
app.post("/login", async (req, res) => {
  let faceSignUserId: string = crypto.randomUUID();

  const { faceScan, key, userAgent, auditTrailImage, lowQualityAuditTrailImage, sessionId } =
    req.body;

  try {
    // First check if liveness is proven
    const { success, wasProcessed, scanResultBlob, error } = await enrollment3d(
      faceSignUserId,
      faceScan,
      auditTrailImage,
      lowQualityAuditTrailImage,
      key,
      userAgent,
      sessionId,
    );

    if (!success || !wasProcessed || error) {
      agent.writeLog("enrollment-failed", { success, wasProcessed, error });

      return res.status(400).json({
        success,
        wasProcessed,
        error,
        errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      });
    }

    // Search for 3d-db duplicates
    let results: { identifier: string; matchLevel: number }[] = [];

    const searchResult = await searchForDuplicates(faceSignUserId, key, GROUP_NAME, userAgent);

    if (searchResult.success) {
      results = searchResult.results;
    } else if (
      searchResult.error &&
      searchResult.errorMessage?.includes("groupName when that groupName does not exist")
    ) {
      // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
      const memberCount = await countMembersInGroup(GROUP_NAME);
      if (memberCount > 0) {
        throw new Error("Group exists in our DB, but not in 3d-db, this should never happen.");
      }

      console.log("Group does not exist, creating one by enrolling first user.");
      results = [];
    } else {
      throw new Error("Failed to search for duplicates, check application logs.");
    }

    const newUser = results.length === 0;

    if (newUser) {
      // Brand new user, let's enroll in 3d-db#users
      agent.writeLog("new-user", { identifier: faceSignUserId });
      await enrollUser(faceSignUserId, GROUP_NAME, key);
      await insertMember(GROUP_NAME, faceSignUserId);
    } else if (results.length > 1) {
      agent.writeLog("duplicate-error", {
        identifiers: results.map((x) => x.identifier),
        count: results.length,
      });
      throw new Error("Multiple users found with the same face-vector.");
    } else {
      agent.writeLog("duplicate", {
        identifiers: results.map((x) => x.identifier),
        count: results.length,
      });
      // biome-ignore lint/style/noNonNullAssertion: This is safe because we check results.length > 1
      faceSignUserId = results[0]?.identifier!;
    }

    // Issue JWT token
    const token = jwt.sign(
      { sub: faceSignUserId },
      readFileSync(JWT_PRIVATE_KEY, "utf-8"),
      { algorithm: "ES512", expiresIn: "1m" }, // Token valid for 5 minutes
    );

    return res.status(200).json({
      success: true,
      wasProcessed,
      error: error ?? false,
      scanResultBlob: scanResultBlob,
      faceSignUserId,
      token,
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      agent.writeLog("error", { message: "Unknown error in /login", error });
    } else {
      agent.writeLog("error", { message: error.message, stack: error.stack });
    }

    return res.status(500).json({
      success: false,
      wasProcessed: false,
      error: true,
      // biome-ignore lint/suspicious/noExplicitAny: We want to show the message even if error is not an instance of Error
      errorMessage: `Login process failed, check server logs: ${(error as any).message}`,
    });
  }
});

app.get("/sdk/public-key", (_req, res) => {
  const publicKey = readFileSync(FACETEC_PUBLIC_KEY_PATH, "utf-8");
  res.status(200).send(publicKey);
});

// idOS issuer informations for VCs
app.get("/idos/issuers/1", (_req, res) => {
  res.status(200).json({
    "@context": "https://w3id.org/security/v2",
    id: `${HOST}/idos/issuers/1`,
    assertionMethod: [`${HOST}/idos/keys/1`],
    authentication: [],
  });
});

app.get("/idos/keys/1", (_req, res) => {
  const publicKeyMultibase = readFileSync(KEY_1_MULTIBASE_PUBLIC_PATH, "utf-8").trim();
  res.status(200).send(publicKeyMultibase);
});

export default app;
