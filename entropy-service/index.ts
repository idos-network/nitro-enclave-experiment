import express from "express";
import process from "node:process";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import jwt from "jsonwebtoken";
import { JWT_PUBLIC_KEY } from "./env";
import { fetchOrCreateEntropy } from "./db";
import fs from "node:fs";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));

app.get("/", (_req, res) => {
  res.send("Welcome to the FaceSign entropy API!");
});

app.post("/entropy", async (req, res) => {
  // Validate token from body
  const token = req.body.token;

  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    const publicKey = fs.readFileSync(JWT_PUBLIC_KEY);
    const result = jwt.verify(token, publicKey, { algorithms: ["HS512"] });
    const entropy = await fetchOrCreateEntropy(result.sub as string);

    res.json({ faceSignUserId: result.sub, entropy });
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
});

const port = process.env.PORT || 8000;

app.listen(port);
console.log(`Server is running on http://localhost:${port}`);
