import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import crypto from "node:crypto";

import { enrollment3d, enrollUser, getSessionToken, searchForDuplicates } from "./api.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT ?? 8080;

app.get("/", (req, res) => {
  res.json({ message: "FaceSign Service is running" });
});

// Session-Token
app.post("/session-token", async (req, res) => {
  try {
    const sessionToken = await getSessionToken(req.body.key, req.body.deviceIdentifier);
    return res.status(200).json({ success: true, sessionToken });
  } catch (error) {
    console.error("Error getting session token:", error);
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
      return res.status(400).json({
        success,
        wasProcessed,
        error,
        errorMessage: 'Liveness check or enrollment 3D failed and was not processed.',
      });
    }

    // Search for 3d-db duplicates
    const { results } = await searchForDuplicates(externalDatabaseRefID, key, userAgent);

    let newUser = results.length === 0;

    if (newUser === 0) {
      // Brand new user, let's enroll in 3d-db#users
      await enrollUser(externalDatabaseRefID, key);
    } else if (results.length > 1) {
      throw new Error('Multiple users found with the same face-vector, this should never happen.');
    } else {
      faceSignUserId = results[0].identifier;
    }

    return res.status(200).json({
      success: true,
      scanResultBlob: scanResultBlob,
      faceSignUserId,
    });
  } catch (error) {
    console.error("Error during login process:", error);

    return res.status(500).json({
      success: false,
      wasProcessed: false,
      error: true,
      errorMessage: 'Login process failed, check server logs.'
    });
  }
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
