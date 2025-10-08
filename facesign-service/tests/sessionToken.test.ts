import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../providers/agent.ts";
import * as facetecApi from "../providers/api.ts";

// Mock modules before importing the app
vi.mock("../providers/db.ts", () => ({
	insertMember: vi.fn(),
	countMembersInGroup: vi.fn(),
	getMembers: vi.fn(),
}));

import app from "../server.ts";

describe("Session token API", () => {
	it("should return session token on success", async () => {
		const spy = vi
			.spyOn(facetecApi, "getSessionToken")
			.mockResolvedValue("mock-session-token");
		const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

		const response = await request(app).post("/session-token").send({
			key: "test-key",
			deviceIdentifier: "test-device-id",
		});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			success: true,
			sessionToken: "mock-session-token",
		});
		expect(spy).toHaveBeenCalledWith("test-key", "test-device-id");
		expect(agentSpy).toHaveBeenCalledWith("session-token", {
			deviceIdentifier: "test-device-id",
		});
	});

	it("should handle errors from getSessionToken", async () => {
		const error = new Error("Failed to get session token");
		const spy = vi
			.spyOn(facetecApi, "getSessionToken")
			.mockRejectedValue(error);
		const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

		const response = await request(app).post("/session-token").send({
			key: "test-key",
			deviceIdentifier: "test-device-id",
		});

		expect(response.status).toBe(500);
		expect(response.body).toEqual({
			success: false,
			message: "Failed to get session token, check server logs.",
		});
		expect(spy).toHaveBeenCalledWith("test-key", "test-device-id");
		expect(agentSpy).toHaveBeenCalledWith("error", {
			message: error.message,
			stack: error.stack,
		});
	});
});
