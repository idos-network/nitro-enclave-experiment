import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../providers/agent.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
	namedCurve: "secp521r1",
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

vi.mock("fs", async () => {
	const actualFs = await vi.importActual<typeof import("fs")>("fs");

	return {
		...actualFs,
		readFileSync: vi.fn(() => publicKey),
	};
});

// Mock modules before importing the app
vi.mock("../providers/db.ts", () => ({
	fetchOrCreatePinocchioEntropy: vi.fn(),
}));

import * as db from "../providers/db.ts";

import app from "../server.ts";

describe("Entropy API", () => {
	it("missing token", async () => {
		const response = await request(app).post("/pinocchio-entropy").send({});

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Token is required" });
	});

	it("new user no entropy", async () => {
		const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});
		const entropySpy = vi
			.spyOn(db, "fetchOrCreatePinocchioEntropy")
			.mockResolvedValue({
				insert: true,
				entropy: "mock test entropy",
			});

		const userId = crypto.randomUUID();
		const token = jwt.sign(
			{
				sub: userId,
			},
			privateKey,
			{
				algorithm: "ES512",
			},
		);

		const response = await request(app).post("/pinocchio-entropy").send({
			token,
		});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			faceSignUserId: userId,
			entropy: "mock test entropy",
		});

		expect(entropySpy).toHaveBeenCalledWith(userId);
		expect(agentSpy).toHaveBeenCalledWith("pinocchio-entropy-created", {
			userId,
			ip: "::ffff:127.0.0.1",
		});
	});

	it("user with existing entropy", async () => {
		const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});
		const entropySpy = vi
			.spyOn(db, "fetchOrCreatePinocchioEntropy")
			.mockResolvedValue({
				insert: false,
				entropy: "mock test entropy",
			});

		const userId = crypto.randomUUID();
		const token = jwt.sign(
			{
				sub: userId,
			},
			privateKey,
			{
				algorithm: "ES512",
			},
		);

		const response = await request(app).post("/pinocchio-entropy").send({
			token,
		});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			faceSignUserId: userId,
			entropy: "mock test entropy",
		});

		expect(entropySpy).toHaveBeenCalledWith(userId);
		expect(agentSpy).toHaveBeenCalledWith("pinocchio-entropy-fetched", {
			userId,
			ip: "::ffff:127.0.0.1",
		});
	});

	it("invalid token", async () => {
		const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

		const response = await request(app).post("/pinocchio-entropy").send({
			token: "invalid-token",
		});

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Invalid token" });
		expect(agentSpy).toHaveBeenCalledWith("pinocchio-error-verify", {
			error: expect.any(Error),
			message: "Invalid token",
		});
	});

	it("expired token", async () => {
		const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

		const userId = crypto.randomUUID();
		const token = jwt.sign(
			{
				sub: userId,
				iat: Math.floor(Date.now() / 1000) - 60, // Issued 60 seconds ago
			},
			privateKey,
			{
				algorithm: "ES512",
			},
		);

		const response = await request(app).post("/pinocchio-entropy").send({
			token,
		});

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Token already expired" });
		expect(agentSpy).toHaveBeenCalledWith("pinocchio-error-iat", {
			message: "Token is too old",
			iat: expect.any(Number),
			now: expect.any(Number),
		});
	});
});
