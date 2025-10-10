import fs from "node:fs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import { JWT_PUBLIC_KEY } from "./env.ts";
import agent from "./providers/agent.ts";
import { fetchOrCreateEntropy } from "./providers/db.ts";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));

app.get("/", (_req, res) => {
	res.status(200).json({ message: "Welcome to the FaceSign entropy API!" });
});

app.post("/entropy", async (req, res) => {
	// Validate token from body
	const token = req.body.token;

	if (!token) {
		return res.status(400).json({ error: "Token is required" });
	}

	try {
		const publicKey = fs.readFileSync(JWT_PUBLIC_KEY);
		const result = jwt.verify(token, publicKey, { algorithms: ["HS512"] });
		const entropy = await fetchOrCreateEntropy(result.sub as string);

		res.json({ faceSignUserId: result.sub, entropy });
	} catch (error) {
		agent.writeLog("error", { error });
		res.status(401).json({ error: "Invalid token" });
	}
});

export default app;
