// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../providers/agent.ts";

// Mock modules before importing the app
vi.mock("../providers/db.ts", () => ({
  insertMember: vi.fn(),
  countMembersInGroup: vi.fn(),
  getMembers: vi.fn(),
}));

import { ObjectId } from "mongodb";
import * as db from "../providers/db.ts";

import app from "../server.ts";

describe("Login API", () => {
  it("return new session", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        responseBlob: "mock-session-result-blob",
      }),
    } as any);

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(200);
    expect(response.body.responseBlob).toBe("mock-session-result-blob");
    expect(response.body.sessionStart).toBe(true);
  });

  it("fail with error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Server error",
    } as any);

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      didError: true,
      errorMessage: "FaceTec API Error in enrollment3d, status code: 500",
      methodName: "enrollment3d",
    });
  });

  it("new user", async () => {
    const spyFetch = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url.toString().endsWith("/process-request")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: { livenessProven: true },
            didError: false,
            responseBlob: "mock-scan-result-blob",
          }),
        } as any;
      }

      if (url.toString().endsWith("3d-db/search")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            results: [],
          }),
        } as any;
      }

      return {
        ok: true,
        json: async () => ({
          success: true,
        }),
      } as any;
    });

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      success: true,
    });

    expect(agentSpy).toHaveBeenCalledWith("login-new-user", {
      identifier: response.body.faceSignUserId,
      groupName: "facesign-users",
    });

    expect(insertMemberSpy).toHaveBeenCalledWith("facesign-users", response.body.faceSignUserId);

    expect(spyFetch).toHaveBeenCalledTimes(3);

    const processRequestCall = spyFetch.mock.calls.find((call) =>
      call[0].toString().endsWith("/process-request"),
    );

    expect(processRequestCall).toBeDefined();
    const body = JSON.parse(processRequestCall?.[1]?.body as string);

    expect(body.externalDatabaseRefID).toBe(response.body.faceSignUserId);
    expect(body.storeAsVector).toBe(true);
    expect(body.requestBlob).toBe("test-face-scan");
  });

  it("new user (different group and faceMap instead of vectors)", async () => {
    const spyFetch = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url.toString().endsWith("/process-request")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: { livenessProven: true },
            didError: false,
            responseBlob: "mock-scan-result-blob",
          }),
        } as any;
      }

      if (url.toString().endsWith("3d-db/search")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            results: [],
          }),
        } as any;
      }

      return {
        ok: true,
        json: async () => ({
          success: true,
        }),
      } as any;
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
      groupName: "test-users",
      faceVector: false,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      success: true,
      result: { livenessProven: true },
    });

    const processRequestCall = spyFetch.mock.calls.find((call) =>
      call[0].toString().endsWith("/process-request"),
    );

    expect(processRequestCall).toBeDefined();
    const body = JSON.parse(processRequestCall?.[1]?.body as string);

    expect(body.externalDatabaseRefID).toBe(response.body.faceSignUserId);
    expect(body.storeAsVector).toBe(false);
    expect(body.requestBlob).toBe("test-face-scan");

    expect(agentSpy).toHaveBeenCalledWith("login-new-user", {
      identifier: response.body.faceSignUserId,
      groupName: "test-users",
    });
  });

  it("failing liveness", async () => {
    const spyFetch = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url.toString().endsWith("/process-request")) {
        return {
          ok: true,
          json: async () => ({
            success: false,
            result: { livenessProven: false },
            didError: true,
            responseBlob: "mock-scan-result-blob",
          }),
        } as any;
      }
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      responseBlob: "mock-scan-result-blob",
      success: false,
      didError: true,
      result: { livenessProven: false },
    });

    expect(agentSpy).toHaveBeenCalledWith("login-enrollment-failed", {
      success: false,
      result: {
        livenessProven: false,
      },
      didError: true,
    });

    expect(spyFetch).toHaveBeenCalledTimes(1);
  });

  it("duplicate (normal)", async () => {
    const resultId = crypto.randomUUID();

    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url.toString().endsWith("/process-request")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: { livenessProven: true },
            didError: false,
            responseBlob: "mock-scan-result-blob",
          }),
        } as any;
      }

      if (url.toString().endsWith("3d-db/search")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            results: [{ identifier: resultId, matchLevel: 15 }],
          }),
        } as any;
      }

      return {
        ok: true,
        json: async () => ({
          success: true,
        }),
      } as any;
    });

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      faceSignUserId: resultId,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      success: true,
      didError: false,
    });

    expect(agentSpy).toHaveBeenCalledWith("login-duplicate", {
      count: 1,
      identifiers: [resultId],
      groupName: "facesign-users",
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
  });

  it("duplicate (error)", async () => {
    const resultId = crypto.randomUUID();
    const resultId2 = crypto.randomUUID();

    const spyFetch = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url.toString().endsWith("/process-request")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: { livenessProven: true },
            didError: false,
            responseBlob: "mock-scan-result-blob",
          }),
        } as any;
      }

      if (url.toString().endsWith("3d-db/search")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            results: [
              { identifier: resultId, matchLevel: 15 },
              { identifier: resultId2, matchLevel: 15 },
            ],
          }),
        } as any;
      }

      return {
        ok: true,
        json: async () => ({
          success: true,
        }),
      } as any;
    });

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: true,
      didError: false,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      errorMessage:
        "Login process failed, check server logs: Multiple users found with the same face-vector.",
    });

    expect(agentSpy).toBeCalledWith("login-duplicate-error", {
      count: 2,
      identifiers: [resultId, resultId2],
      groupName: "facesign-users",
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
    expect(spyFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("convert-to-vector"),
      expect.any(Object),
    );
  });
});
