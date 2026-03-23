import { readFileSync } from "node:fs";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import { JWT_PUBLIC_KEY } from "./env.ts";
import agent from "./providers/agent.ts";
import { fetchOrCreateFaceSignEntropy } from "./providers/db.ts";
import {
	getRequestId,
	runWithRequestContext,
} from "./utils/request-context.ts";

morgan.token("requestId", () => getRequestId() ?? "-");

const app = express();

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minute
	limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minute).
	legacyHeaders: false,
	standardHeaders: false,
	ipv6Subnet: 56,
});

app.set("trust proxy", "loopback");
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
app.use(
	morgan(":requestId :remote-addr :method :url :status :response-time ms"),
);
app.use(express.json({ limit: "5mb" }));
app.use(limiter);

app.get("/", (_req, res) => {
	res.status(200).json({ message: "Welcome to the FaceSign entropy API!" });
});

app.post("/facesign/entropy", async (req, res) => {
	// Validate token from body
	const token = req.body.token;

	if (!token) {
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
		agent.writeLog("facesign-entropy-error-verify", {
			message: "Invalid token",
			error,
		});
		return res.status(400).json({ error: "Invalid token" });
	}

	if (!result.iat || !result.sub) {
		agent.writeLog("facesign-entropy-error-validate", {
			message: "Token missing iat or sub",
		});
		return res.status(400).json({ error: "Invalid token" });
	}

	if (Date.now() / 1000 - result.iat > 1 * 60) {
		agent.writeLog("facesign-entropy-error-iat", {
			message: "Token is too old",
			iat: result.iat,
			now: Date.now() / 1000,
		});
		return res.status(400).json({ error: "Token already expired" });
	}

	const { insert, entropy } = await fetchOrCreateFaceSignEntropy(
		result.sub as string,
	);

	agent.writeLog(`facesign-entropy-${insert ? "created" : "fetched"}`, {
		userId: result.sub,
		ip: req.ip,
	});

	return res.json({ faceSignUserId: result.sub, entropy });
});

export default app;
