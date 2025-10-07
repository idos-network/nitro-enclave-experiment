import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import jwt from "jsonwebtoken";
import fs from "node:fs";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));

app.get("/", (_req, res) => {
  res.send("Welcome to the FaceSign entropy API!");
});

app.post("/entropy", (req, res) => {
  // Validate token from body
  const token = req.body.token;

  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    const publicKey = fs.readFileSync("./jwt_public_key.pem");
    const result = jwt.verify(token, publicKey, { algorithms: ["RS256"] });

    const mn = bip39.generateMnemonic(wordlist, 256);

    res.json({ message: "Token is valid", mnemonic: mn });
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
});

const port = process.env.PORT || 8000;

app.listen(port);
console.log(`Server is running on http://localhost:${port}`);
