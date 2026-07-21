import cors from "cors";
import express, { type Express } from "express";
import promBundle from "express-prom-bundle";
import helmet from "helmet";
import { sessionKeyMiddleware } from "./middleware/session-key.ts";
import { decrypt, encrypt } from "./providers/encryption.ts";
import { getPublicKeyJWK } from "./providers/kms.ts";
import loggerMiddleware from "./providers/logger.ts";
import { createSession } from "./providers/session.ts";
import { writeLog } from "./utils/logger-context.ts";
import { runWithRequestContext } from "./utils/request-context.ts";

const app: Express = express();

app.use(loggerMiddleware);

app.set("trust proxy", "loopback");

app.use(
	promBundle({
		includeMethod: true,
	}),
);

app.use(helmet());
app.use(cors());
app.use((req, res, next) => {
	const requestId = req.header("x-request-id") || crypto.randomUUID();
	res.setHeader("x-request-id", requestId);
	runWithRequestContext(
		{ requestId, ...(req.ip !== undefined ? { remoteIp: req.ip } : {}) },
		next,
	);
});
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
	res.status(200).json({ message: "Encryption Service is running" });
});

app.get("/health", async (_req, res) => {
	res.status(200).json({ status: "ok" });
});

app.get("/.well-known/jwks.json", async (_req, res) => {
	const key = await getPublicKeyJWK();
	res.status(200).json({ keys: [key] });
});

app.post("/session", async (_req, res) => {
	const session = await createSession();
	writeLog("session_created", { sessionId: session.sessionId });
	res.status(200).json(session);
});

app.post("/session/public-key", sessionKeyMiddleware, async (req, res) => {
	writeLog("public_key_request", { sessionId: req.sessionRequest.sessionId });

	return res.json({
		sessionId: req.sessionRequest.sessionId,
		publicKey: Buffer.from(req.keyPair.publicKey).toString("base64"),
	});
});

app.post("/session/encrypt", sessionKeyMiddleware, async (req, res) => {
	writeLog("encrypt_request", { sessionId: req.sessionRequest.sessionId });

	const data = await encrypt(
    req.keyPair,
    req.sessionRequest.publicKey,
    req.sessionRequest.data,
  );

	return res.json({ data });
});

app.post("/session/decrypt", sessionKeyMiddleware, async (req, res) => {
	writeLog("decrypt_request", { sessionId: req.sessionRequest.sessionId });

	const data = await decrypt(
    req.keyPair,
    req.sessionRequest.publicKey,
    req.sessionRequest.data,
  );

	return res.json({ data });
});

export default app;
