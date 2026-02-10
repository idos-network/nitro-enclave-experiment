// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../providers/agent.ts";
import app from "../server.ts";
import { mockFetchByEndpoint } from "./utils/facesign-test-helpers.ts";

// This is required, otherwise it will fail due to missing DB
vi.mock("../providers/db.ts", () => ({
  insertMember: vi.fn(),
  countMembersInGroup: vi.fn(),
  getMembers: vi.fn(),
  getOldestFaceSignUserId: vi.fn(),
}));

describe("Match Login API", () => {
  it("return new session", async () => {
    mockFetchByEndpoint([], {
      json: {
        responseBlob: "mock-session-result-blob",
      },
    });

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    console.log(response.body);

    expect(response.status).toBe(200);
    expect(response.body.responseBlob).toBe("mock-session-result-blob");
  });

  it("user match (level 15)", async () => {
    const spyFetch = mockFetchByEndpoint([
      {
        endsWith: "/process-request",
        response: {
          json: {
            success: true,
            result: { livenessProven: true, matchLevel: 15 },
            didError: false,
            responseBlob: "mock-scan-result-blob",
          },
        },
      },
    ]);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true, matchLevel: 15 },
      success: true,
    });

    expect(agentSpy).toHaveBeenCalledWith("match-3d-3d-done", {
      identifier: "test-user-id",
      matchLevel: 15,
    });

    expect(spyFetch).toHaveBeenCalledTimes(1);
    const processRequestCall = spyFetch.mock.calls.find((call) =>
      call[0].toString().endsWith("/process-request"),
    );

    expect(processRequestCall).toBeDefined();
    const body = JSON.parse(processRequestCall?.[1]?.body as string);
    expect(body.externalDatabaseRefID).toBe("test-user-id");
    expect(body.requestBlob).toBe("test-face-scan");
  });

  it("failing liveness", async () => {
    mockFetchByEndpoint([
      {
        endsWith: "/process-request",
        response: {
          json: {
            success: false,
            result: { livenessProven: false },
            didError: false,
            responseBlob: "invalid-result-blob",
          },
        },
      },
    ]);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      success: false,
      didError: false,
      responseBlob: "invalid-result-blob",
      result: { livenessProven: false },
    });

    expect(agentSpy).toHaveBeenCalledWith("match-3d-3d-failed", {
      success: false,
      externalUserId: "test-user-id",
      result: { livenessProven: false },
    });
  });

  it("liveness done, but no match", async () => {
    mockFetchByEndpoint([
      {
        endsWith: "/process-request",
        response: {
          json: {
            success: false,
            result: { livenessProven: true },
            didError: false,
            responseBlob: "invalid-result-blob",
          },
        },
      },
    ]);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      errorMessage: "No match found for the provided face scan.",
      success: false,
      didError: false,
      responseBlob: "invalid-result-blob",
      result: { livenessProven: true },
    });

    expect(agentSpy).toHaveBeenCalledWith("match-3d-3d-no-match", {
      success: false,
      externalUserId: "test-user-id",
      result: { livenessProven: true },
    });
  });

  it("match error", async () => {
    mockFetchByEndpoint([
      {
        endsWith: "/process-request",
        response: {
          ok: false,
          status: 500,
          text: "Some unexpected error",
          json: {
            success: false,
            result: { livenessProven: false },
            didError: false,
            responseBlob: "invalid-result-blob",
          },
        },
      },
    ]);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/match").send({
      requestBlob: "test-face-scan",
      externalUserId: "test-user-id",
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      didError: true,
      errorMessage: "FaceTec API Error in match3d3d, status code: 500",
      methodName: "match3d3d",
      success: false,
    });

    expect(agentSpy).toHaveBeenCalledWith("facetec-api-error", {
      methodName: "match3d3d",
      others: {
        externalDatabaseRefID: "test-user-id",
      },
      response: {
        body: "Some unexpected error",
        code: 500,
      },
    });
  });
});
