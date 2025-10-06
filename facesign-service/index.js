import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import crypto from "node:crypto";
import fs from "node:fs";
import agent from "./agent.js";

import { enrollment3d, enrollUser, getSessionToken, searchForDuplicates } from "./api.js";
import { insertMember, countMembersInGroup } from "./db.js";
import { FACETEC_PUBLIC_KEY_PATH, GROUP_NAME, KEY_1_MULTIBASE_PUBLIC_PATH, HOST } from "./env.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT ?? 7000;

app.get("/", (req, res) => {
  res.json({ message: "FaceSign Service is running" });
});

// Session-Token
app.post("/session-token", async (req, res) => {
  try {
    const sessionToken = await getSessionToken(req.body.key, req.body.deviceIdentifier);
    agent.writeLog("session-token", { deviceIdentifier: req.body.deviceIdentifier });
    return res.status(200).json({ success: true, sessionToken });
  } catch (error) {
    console.error("Error getting session token:", error);

    agent.writeLog("error", { message: error.message, stack: error.stack });

    return res.status(500).json({
      success: false,
      message: 'Failed to get session token, check server logs.'
    });
  }
});

// Login
app.post("/login", async (req, res) => {
  let faceSignUserId = crypto.randomUUID();

  const { faceScan, key, userAgent, auditTrailImage, lowQualityAuditTrailImage, sessionId } = req.body;

  try {
    // First check if liveness is proven
    const { success, wasProcessed, scanResultBlob, error, ...other } = await enrollment3d(
      faceSignUserId,
      faceScan,
      auditTrailImage,
      lowQualityAuditTrailImage,
      key,
      userAgent,
      sessionId,
    )

    if (!success || !wasProcessed || error) {
      agent.writeLog("enrollment-failed", { success, wasProcessed, error });

      return res.status(400).json({
        success,
        wasProcessed,
        error,
        errorMessage: 'Liveness check or enrollment 3D failed and was not processed.',
      });
    }

    // Search for 3d-db duplicates
    let results = [];

    const searchResult = await searchForDuplicates(faceSignUserId, key, GROUP_NAME, userAgent);

    if (searchResult.success) {
      results = searchResult.results;
    } else if (searchResult.error && searchResult.errorMessage.includes('groupName when that groupName does not exist')) {
      // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
      const memberCount = await countMembersInGroup(GROUP_NAME);
      if (memberCount > 0) {
        throw new Error('Group exists in our DB, but not in 3d-db, this should never happen.');
      }

      console.log("Group does not exist, creating one by enrolling first user.")
      results = [];
    } else {
      throw new Error('Failed to search for duplicates, check application logs.');
    }

    let newUser = results.length === 0;

    if (newUser) {
      // Brand new user, let's enroll in 3d-db#users
      agent.writeLog("new-user", { identifier: results[0].identifier });
      await enrollUser(faceSignUserId, GROUP_NAME, key);
      await insertMember(GROUP_NAME, faceSignUserId);
    } else if (results.length > 1) {
      agent.writeLog("duplicate", { identifiers: results.map(x => x.identifier) });
      throw new Error('Multiple users found with the same face-vector, this should never happen.');
    } else {
      agent.writeLog("duplicate", { identifiers: results[0].identifier });
      faceSignUserId = results[0].identifier;
    }

    return res.status(200).json({
      success: true,
      scanResultBlob: scanResultBlob,
      faceSignUserId,
    });
  } catch (error) {
    console.error("Error during login process:", error);

    agent.writeLog("error", { message: error.message, stack: error.stack });

    return res.status(500).json({
      success: false,
      wasProcessed: false,
      error: true,
      errorMessage: `Login process failed, check server logs ${error.message}.`
    });
  }
});

app.get("/sdk/public-key", (req, res) => {
  const publicKey = fs.readFileSync(FACETEC_PUBLIC_KEY_PATH, "utf-8");
  res.status(200).send(publicKey);
});

// idOS issuer informations for VCs
app.get("/idos/issuers/1", (req, res) => {
  res.status(200).json({
    "@context": "https://w3id.org/security/v2",
    id: `${HOST}/idos/issuers/1`,
    assertionMethod: [`${HOST}/idos/keys/1`],
    authentication: [],
  });
});

app.get("/idos/keys/1", (req, res) => {
  const publicKeyMultibase = fs.readFileSync(KEY_1_MULTIBASE_PUBLIC_PATH, "utf-8").trim();
  res.status(200).send(publicKeyMultibase);
});

const server = app.listen(PORT, () => {
  console.log(`Server started and listening on port ${PORT}`);
});

server.on("error", (err) => {
  if ("code" in err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Please choose another port or stop the process using it.`);
  }
  else {
    console.error("Failed to start server:", err);
  }
  process.exit(1);
});
