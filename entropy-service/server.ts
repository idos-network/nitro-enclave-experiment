import { readFileSync } from "node:fs";
import cors from "cors";
import express, { type Express } from "express";
import promBundle from "express-prom-bundle";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { JWT_PUBLIC_KEY } from "./env.ts";
import { fetchOrCreateFaceSignEntropy } from "./providers/db.ts";
import loggerMiddleware from "./providers/logger.ts";
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

app.post("/facesign/entropy", async (req, res) => {
	// Validate token from body
	const token = req.body.token;

	writeLog("entropy_request");

	if (!token) {
		writeLog("entropy_error_missing_token");
		return res.status(400).json({ error: "Token is required" });
	}

	let result: { sub: string; iat: number };

	try {
		const publicKey = readFileSync(JWT_PUBLIC_KEY);
		result = jwt.verify(token, publicKey, { algorithms: ["ES512"] }) as {
			sub: string;
			iat: number;
		};
	} catch (error) {
		writeLog("entropy_error_invalid_token", { error });
		return res.status(400).json({ error: "Invalid token" });
	}

	if (!result.iat || !result.sub) {
		writeLog("entropy_error_missing_iat_or_sub");
		return res.status(400).json({ error: "Invalid token" });
	}

	if (Date.now() / 1000 - result.iat > 1 * 60) {
		writeLog("entropy_error_too_old", {
			iat: result.iat,
			now: Date.now() / 1000,
		});
		return res.status(400).json({ error: "Token already expired" });
	}

	const { insert, entropy } = await fetchOrCreateFaceSignEntropy(
		result.sub as string,
	);

	if (insert) {
		writeLog("entropy_created", { userId: result.sub, ip: req.ip });
	} else {
		writeLog("entropy_fetched", { userId: result.sub, ip: req.ip });
	}

	return res.json({ faceSignUserId: result.sub, entropy });
});

export default app;
