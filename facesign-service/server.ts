import { readFileSync } from "node:fs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { HOST, KEY_1_MULTIBASE_PUBLIC_PATH } from "./env.ts";
import { getStatus } from "./providers/api.ts";
import login from "./routes/login.ts";
import match from "./routes/match.ts";
import pinnochio from "./routes/pinnochio.ts";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));

app.get("/", (_req, res) => {
  res.json({ message: "FaceSign Service is running" });
});

app.get("/health", async (_req, res) => {
  const status = await getStatus();
  res.status(200).json({ status: "ok", version: status.serverInfo.facetecServerWebserviceVersion });
});

app.post("/login", login);
app.post("/pinocchio", pinnochio);
app.post("/match", match);

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
