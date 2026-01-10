import { readFileSync } from "node:fs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import { JWT_PUBLIC_KEY } from "./env.ts";
import agent from "./providers/agent.ts";
import { fetchOrCreatePinocchioEntropy } from "./providers/db.ts";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));

app.get("/", (_req, res) => {
	res.status(200).json({ message: "Welcome to the FaceSign entropy API!" });
});

app.post("/pinocchio-entropy", async (req, res) => {
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
		agent.writeLog("pinocchio-error-verify", {
			message: "Invalid token",
			error,
		});
		return res.status(400).json({ error: "Invalid token" });
	}

	if (!result.iat || !result.sub) {
		agent.writeLog("pinocchio-error-validate", {
			message: "Token missing iat or sub",
		});
		return res.status(400).json({ error: "Invalid token" });
	}

	if (Date.now() / 1000 - result.iat > 1 * 60) {
		agent.writeLog("pinocchio-error-iat", {
			message: "Token is too old",
			iat: result.iat,
			now: Date.now() / 1000,
		});
		return res.status(400).json({ error: "Token already expired" });
	}

	const { insert, entropy } = await fetchOrCreatePinocchioEntropy(
		result.sub as string,
	);

	agent.writeLog(`pinocchio-entropy-${insert ? "created" : "fetched"}`, {
		userId: result.sub,
		ip: req.ip,
	});

	return res.json({ faceSignUserId: result.sub, entropy });
});

export default app;
