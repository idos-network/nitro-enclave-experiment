import fs from "node:fs";
import cors from "cors";
import express, { type Express } from "express";
import promBundle from "express-prom-bundle";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";

import { sessionKeyMiddleware } from "./middleware/session-key.ts";
import { decrypt, encrypt } from "./providers/encryption.ts";
import { getPublicKeyJWK } from "./providers/kms.ts";
import loggerMiddleware from "./providers/logger.ts";
import { createSession } from "./providers/session.ts";
import {
	CommonRequestSchema,
	CreateSessionRequestSchema,
	type DataRequest,
	DataRequestSchema,
} from "./utils/dto.ts";
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

const file = fs.readFileSync("./openapi.yaml", "utf8");
const swaggerDocument = YAML.parse(file);

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get("/openapi.json", (_req, res) => {
	res.json(swaggerDocument);
});
app.get("/openapi.yaml", (_req, res) => {
	res.type("text/yaml");
	res.send(file);
});

app.get("/.well-known/jwks.json", async (_req, res) => {
	const key = await getPublicKeyJWK();
	res.status(200).json({ keys: [key] });
});

app.post("/session", async (req, res) => {
	const createSessionRequest = CreateSessionRequestSchema.safeParse(req.body);

	if (!createSessionRequest.success) {
		return res.status(400).json({
			error: "Invalid request body",
			details: createSessionRequest.error,
		});
	}

	const session = await createSession(createSessionRequest.data);
	writeLog("session_created", { sessionId: session.id });
	res.status(200).json(session);
});

app.post(
	"/session/public-key",
	sessionKeyMiddleware(CommonRequestSchema),
	async (req, res) => {
		writeLog("public_key_request", {
			sessionId: req.sessionRequest.session.id,
		});

		return res.json({
			sessionId: req.sessionRequest.session.id,
			publicKey: Buffer.from(req.encryptionKeyPair.publicKey).toString(
				"base64",
			),
		});
	},
);

app.post(
	"/session/encrypt",
	sessionKeyMiddleware(DataRequestSchema),
	async (req, res) => {
		writeLog("encrypt_request", {
			sessionId: req.sessionRequest.session.id,
		});

		const sessionRequest = req.sessionRequest as DataRequest;
		const data = await encrypt(
			req.encryptionKeyPair,
			sessionRequest.arguments.publicKey,
			sessionRequest.arguments.payload,
		);

		// TODO: Encrypt for the audience

		return res.json({ data });
	},
);

app.post(
	"/session/decrypt",
	sessionKeyMiddleware(DataRequestSchema),
	async (req, res) => {
		writeLog("decrypt_request", {
			sessionId: req.sessionRequest.session.id,
		});

		const sessionRequest = req.sessionRequest as DataRequest;
		const data = await decrypt(
			req.encryptionKeyPair,
			sessionRequest.arguments.publicKey,
			sessionRequest.arguments.payload,
			sessionRequest.arguments.nonce,
		);

		// TODO: Encrypt for the audience

		return res.json({ data });
	},
);

export default app;
