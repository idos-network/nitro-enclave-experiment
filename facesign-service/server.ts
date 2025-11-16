import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";

import {
  FACETEC_PUBLIC_KEY_PATH,
  GROUP_NAME,
  HOST,
  JWT_PRIVATE_KEY,
  KEY_1_MULTIBASE_PUBLIC_PATH,
} from "./env.ts";
import agent from "./providers/agent.ts";
import {
  enrollment3d,
  enrollUser,
  getSessionToken,
  match3d3d,
  searchForDuplicates,
} from "./providers/api.ts";
import { countMembersInGroup, getOldestFaceSignUserId, insertMember } from "./providers/db.ts";

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

  const {
    faceScan,
    key,
    userAgent,
    auditTrailImage,
    lowQualityAuditTrailImage,
    sessionId,
    groupName = GROUP_NAME,
    faceVector = true,
  } = req.body;

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
      faceVector,
    );

    if (!success || !wasProcessed || error) {
      agent.writeLog("login-enrollment-failed", { success, wasProcessed, error });

      return res.status(400).json({
        success,
        wasProcessed,
        error,
        errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      });
    }

    // Search for 3d-db duplicates
    let results: { identifier: string; matchLevel: number }[] = [];

    const searchResult = await searchForDuplicates(faceSignUserId, key, groupName, userAgent);

    if (searchResult.success) {
      results = searchResult.results;
    } else if (
      searchResult.error &&
      searchResult.errorMessage?.includes("groupName when that groupName does not exist")
    ) {
      // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
      const memberCount = await countMembersInGroup(groupName);
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
      agent.writeLog("login-new-user", {
        identifier: faceSignUserId,
        groupName,
      });
      await enrollUser(faceSignUserId, groupName, key);
      await insertMember(groupName, faceSignUserId);
    } else if (results.length > 1) {
      agent.writeLog("login-duplicate-error", {
        identifiers: results.map((x) => x.identifier),
        count: results.length,
        groupName,
      });
      throw new Error("Multiple users found with the same face-vector.");
    } else {
      agent.writeLog("login-duplicate", {
        identifiers: results.map((x) => x.identifier),
        count: results.length,
        groupName,
      });
      // biome-ignore lint/style/noNonNullAssertion: This is safe because we check results.length > 1
      // biome-ignore lint/suspicious/noNonNullAssertedOptionalChain: This is safe because we check results.length > 1
      faceSignUserId = results[0]?.identifier!;
    }

    return res.status(200).json({
      success: true,
      wasProcessed,
      error: error ?? false,
      scanResultBlob: scanResultBlob,
      faceSignUserId,
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      agent.writeLog("login-error", { message: "Unknown error in /login", error });
    } else {
      agent.writeLog("login-error", { message: error.message, stack: error.stack });
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

// Pinocchio 3D Login
app.post("/pinocchio-login", async (req, res) => {
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
      true,
    );

    if (!success || !wasProcessed || error) {
      agent.writeLog("pinocchio-enrollment-failed", { success, wasProcessed, error });

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
      agent.writeLog("pinocchio-new-user", { identifier: faceSignUserId });
      await enrollUser(faceSignUserId, GROUP_NAME, key);
      await insertMember(GROUP_NAME, faceSignUserId);
    } else {
      // This is a difference from normal /login route
      agent.writeLog("pinocchio-duplicate", {
        identifiers: results.map((x) => x.identifier),
        count: results.length,
      });

      // Choose the "first" one (oldest one)
      // TODO: Check this ...
      faceSignUserId = await getOldestFaceSignUserId(results.map((x) => x.identifier));
    }

    // Issue JWT token
    const token = jwt.sign(
      { sub: faceSignUserId },
      readFileSync(JWT_PRIVATE_KEY, "utf-8"),
      { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
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
      agent.writeLog("pinocchio-error", { message: "Unknown error in /login", error });
    } else {
      agent.writeLog("pinocchio-error", { message: error.message, stack: error.stack });
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

app.post("/match", async (req, res) => {
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
      wasProcessed,
      scanResultBlob,
      error,
      matchLevel,
      retryScreenEnumInt,
      ...others
    } = await match3d3d(
      externalUserId,
      faceScan,
      auditTrailImage,
      lowQualityAuditTrailImage,
      key,
      userAgent,
      sessionId,
    );

    if (!wasProcessed || error) {
      agent.writeLog("match-3d-3d-failed", { success, wasProcessed, error });
    } else {
      agent.writeLog("match-3d-3d-done", {
        identifier: externalUserId,
        matchLevel,
        retryScreenEnumInt,
      });
    }

    return res.status(200).json({
      // Success can be false even if wasProcessed is true (e.g. failed match)
      success,
      wasProcessed,
      scanResultBlob,
      error,
      // We have to differentiate between failed match and failed liveness
      // in the UI we want user to repeat liveness check if this fails
      livenessDone: others.faceScanSecurityChecks.faceScanLivenessCheckSucceeded,
      retryScreenEnumInt,
      // 0-15
      matchLevel,
      others,
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
