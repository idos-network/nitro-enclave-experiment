import cors from "cors";
import express, { type Express } from "express";
import promBundle from "express-prom-bundle";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { getPublicKey } from "./providers/kms.ts";
import loggerMiddleware from "./providers/logger.ts";
import { createSession } from "./providers/session.ts";
import { writeLog } from "./utils/logger-context.ts";
import { runWithRequestContext } from "./utils/request-context.ts";

const app: Express = express();

app.use(loggerMiddleware);

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minute
	limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minute).
	legacyHeaders: false,
	standardHeaders: false,
	ipv6Subnet: 56,
	skip: (req) =>
		req.url.startsWith("/metrics") || req.url.startsWith("/health"),
});

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
app.use(express.json({ limit: "5mb" }));
app.use(limiter);

app.get("/", (_req, res) => {
	res.status(200).json({ message: "Entropy Service is running" });
});

app.get("/health", async (_req, res) => {
	res.status(200).json({ status: "ok" });
});

// Get the public ED25519 key for signing
app.get("/key", async (_req, res) => {
	const key = await getPublicKey();
	res.status(200).json({ key });
});

app.post("/session", async (_req, res) => {
	const session = await createSession();
	res.status(200).json(session);
});

app.post("/encrypt", async (req, res) => {
	// Validate token from body
	const sessionId = req.body.sessionId;
	const wrappedKey = req.body.wrappedKey;
	const data = req.body.data;

	writeLog("encrypt_request", { sessionId });

	if (!sessionId || !wrappedKey || !data) {
		writeLog("encrypt_request_missing_required_fields");
		return res
			.status(400)
			.json({ error: "Session ID, wrapped key and data are required" });
	}

	// TODO: Encrypt

	return res.json({ encryptedData: "encryptedData" });
});

app.post("/decrypt", async (req, res) => {
	const sessionId = req.body.sessionId;
	const wrappedKey = req.body.wrappedKey;
	const data = req.body.data;

	writeLog("decrypt_request", { sessionId });

	if (!sessionId || !wrappedKey || !data) {
		writeLog("decrypt_request_missing_required_fields");
		return res
			.status(400)
			.json({ error: "Session ID, wrapped key and data are required" });
	}

	// TODO: Decrypt

	return res.json({ decryptedData: "decryptedData" });
});

export default app;
