import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router,
} from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import cron from "node-cron";
// Configurations and providers
import { HOST, KEY_1_MULTIBASE_PUBLIC_PATH } from "./env.ts";
import { relayJwtAuthMiddleware } from "./middleware/relay-jwt-auth.ts";
import agent from "./providers/agent.ts";
import { getStatus } from "./providers/api.ts";
import { deleteAuditTrailImagesOlderThan14Days } from "./providers/db.ts";
import {
  Enrollment3DRecoverableError,
  FaceTecError,
  FFRError,
  InternalServerError,
  SessionStartError,
} from "./providers/errors.ts";

// FaceSign Routes
import { confirmation as faceSignConfirmation, login as faceSignLogin } from "./routes/facesign.ts";
// idOS Relay Routes
import liveness from "./routes/liveness.ts";
import match from "./routes/match.ts";
import matchIdDoc from "./routes/match-id-doc.ts";
import selfie from "./routes/selfie.ts";
import uniqueness from "./routes/uniqueness.ts";
import { getRequestId, runWithRequestContext } from "./utils/request-context.ts";

morgan.token("requestId", () => getRequestId() ?? "-");

const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute
  limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minute).
  legacyHeaders: false,
  standardHeaders: false,
  ipv6Subnet: 56,
});

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
app.use((req, res, next) => {
  const requestId = req.header("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  runWithRequestContext({ requestId, ...(req.ip !== undefined ? { remoteIp: req.ip } : {}) }, next);
});
app.use(morgan(":requestId :remote-addr :method :url :status :response-time ms"));
app.use(express.json({ limit: "25mb" }));
app.use(limiter);

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

// idOS Relay Routes (JWT bearer — env RELAY_JWT_PUBLIC_KEY PEM / openapi.yaml)
const relayRouter: Router = express.Router();
relayRouter.use(relayJwtAuthMiddleware);
relayRouter.post("/liveness", asyncHandler(liveness));
relayRouter.post("/uniqueness", asyncHandler(uniqueness));
relayRouter.post("/match", asyncHandler(match));
relayRouter.post("/match-id-doc", asyncHandler(matchIdDoc));
relayRouter.get("/selfie/:selfieId", asyncHandler(selfie));
app.use("/relay", relayRouter);

// FaceSign routes
const faceSignRouter: Router = express.Router();
faceSignRouter.post("/", asyncHandler(faceSignLogin));
faceSignRouter.post("/confirmation", asyncHandler(faceSignConfirmation));
app.use("/facesign", faceSignRouter);

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
    agent.writeLog("session-start-response-blob", { launchId: err.launchId });

    return res.status(200).json({
      responseBlob: err.responseBody,
      sessionStart: true,
      launchId: err.launchId,
    });
  }

  if (err instanceof Enrollment3DRecoverableError) {
    agent.writeLog("enrollment3d-recoverable-error", {
      success: err.response.success,
      launchId: err.response.launchId,
      error: err.message,
      didError: err.response.didError,
      result: err.response.result,
    });

    return res.status(400).json({
      success: err.response.success,
      responseBlob: err.response.responseBlob,
      didError: err.response.didError,
      additionalSessionData: err.response.additionalSessionData,
      result: err.response.result,
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
    });
  }

  if (err instanceof FFRError) {
    agent.writeLog("ffr-error", { message: err.message });

    return res.status(409).json({
      errorMessage: err.message,
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

  if (err instanceof InternalServerError) {
    agent.writeLog("general-error", { message: err.message });

    return res.status(500).json({
      errorMessage: err.message,
    });
  }

  console.error(err);
  agent.writeLog("general-error", { message: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

// Cron job to delete audit trail images older than 14 days
cron.schedule("0 0 * * *", async () => {
  agent.writeLog("delete-audit-trail-images-cron-job", {
    message: "Deleting audit trail images older than 14 days",
  });

  try {
    await deleteAuditTrailImagesOlderThan14Days();
  } catch (error: unknown) {
    agent.writeLog("delete-audit-trail-images-cron-job-error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default app;
