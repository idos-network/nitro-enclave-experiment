import { readFileSync } from "node:fs";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import helmet from "helmet";
import morgan from "morgan";

import { HOST, KEY_1_MULTIBASE_PUBLIC_PATH } from "./env.ts";
import agent from "./providers/agent.ts";
import { FaceTecError, getStatus, SessionStartError } from "./providers/api.ts";
import login from "./routes/login.ts";
import match from "./routes/match.ts";
import pinocchio from "./routes/pinocchio.ts";

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

export const asyncHandler = (
  // biome-ignore lint/suspicious/noExplicitAny: any is needed here
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

app.post("/login", asyncHandler(login));
app.post("/pinocchio", asyncHandler(pinocchio));
app.post("/match", asyncHandler(match));

// idOS issuer information for VCs
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

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof SessionStartError) {
    agent.writeLog("session-start-response-blob", {});
    return res.status(200).json({
      responseBlob: err.responseBody,
      sessionStart: true,
    });
  }

  if (err instanceof FaceTecError) {
    agent.writeLog("facetec-api-error", {
      methodName: err.methodName,
      response: err.response,
      others: err.others,
    });

    return res.status(500).json({
      success: false,
      didError: true,
      methodName: err.methodName,
      errorMessage: `FaceTec API Error in ${err.methodName}, status code: ${err.response.code}`,
    });
  }

  console.error(err);
  agent.writeLog("general-error", { message: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

export default app;
