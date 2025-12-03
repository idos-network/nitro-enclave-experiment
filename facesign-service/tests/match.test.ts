// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../providers/agent.ts";
import * as facetecApi from "../providers/api.ts";

import app from "../server.ts";

// This is required, otherwise it will fail due to missing DB
vi.mock("../providers/db.ts", () => ({
  insertMember: vi.fn(),
  countMembersInGroup: vi.fn(),
  getMembers: vi.fn(),
  getOldestFaceSignUserId: vi.fn(),
}));

describe("Match Login API", () => {
  it("return new session", async () => {
    const matchSpy = vi.spyOn(facetecApi, "match3d3d").mockResolvedValue({
      responseBlob: "mock-session-result-blob",
    } as any);

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    expect(response.status).toBe(200);
    expect(response.body.responseBlob).toBe("mock-session-result-blob");
    expect(matchSpy).toHaveBeenCalledWith("test-user-id", "test-face-scan");
  });

  it("user match (level 15)", async () => {
    const matchSpy = vi.spyOn(facetecApi, "match3d3d").mockResolvedValue({
      success: true,
      result: { livenessProven: true, matchLevel: 15 },
      responseBlob: "mock-scan-result-blob",
      didError: false,
    } as any);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => { });

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      didError: false,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true, matchLevel: 15 },
      success: true,
    });

    expect(matchSpy).toHaveBeenCalledWith("test-user-id", "test-face-scan");
    expect(agentSpy).toHaveBeenCalledWith("match-3d-3d-done", {
      identifier: "test-user-id",
      matchLevel: 15,
    });
  });

  it("failing liveness", async () => {
    vi.spyOn(facetecApi, "match3d3d").mockResolvedValue({
      success: false,
      result: { livenessProven: false },
      responseBlob: "invalid-response-blob",
      didError: true,
    } as any);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => { });

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      success: false,
      didError: true,
      responseBlob: "invalid-response-blob",
      result: { livenessProven: false },
    });

    expect(agentSpy).toHaveBeenCalledWith("match-3d-3d-failed", {
      success: false,
      externalUserId: "test-user-id",
      result: { livenessProven: false },
    });
  });

  it("match error", async () => {
    vi.spyOn(facetecApi, "match3d3d").mockRejectedValue({
      message: "Some unexpected error",
    } as any);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => { });

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      didError: true,
      error: true,
      errorMessage: "Match process failed, check server logs.",
    });

    expect(agentSpy).toHaveBeenCalledWith("match-error", {
      error: {
        message: "Some unexpected error",
      },
      message: "Unknown error in /match",
    });
  });
});
