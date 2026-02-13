// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any

import { ObjectId } from "mongodb";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../../providers/agent.ts";
import * as db from "../../providers/db.ts";
import app from "../../server.ts";
import {
  processRequestErrorHandler,
  processRequestHandler,
  requestCapture,
  searchHandler,
  sessionStartHandler,
} from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("Login API", () => {
  it("return new session", async () => {
    server.use(sessionStartHandler("mock-session-result-blob"));

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(200);
    expect(response.body.responseBlob).toBe("mock-session-result-blob");
    expect(response.body.sessionStart).toBe(true);
  });

  it("fail with error", async () => {
    server.use(processRequestErrorHandler(500, "Server error"));

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

  it("new user (default group and face vector)", async () => {
    server.use(
      processRequestHandler({
        success: true,
        result: { livenessProven: true },
        didError: false,
        responseBlob: "mock-scan-result-blob",
      }),
      searchHandler([]),
    );

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
      faceSign: null,
      success: true,
    });

    expect(agentSpy).toHaveBeenCalledWith("login-new-user", {
      identifier: response.body.faceSignUserId,
      groupName: "facesign-users",
    });

    expect(insertMemberSpy).toHaveBeenCalledWith("facesign-users", response.body.faceSignUserId);

    // Verify FaceTec API calls
    const processRequest = requestCapture.getLastByEndpoint("/process-request");
    expect(processRequest?.body).toMatchObject({
      externalDatabaseRefID: response.body.faceSignUserId,
      requestBlob: "test-face-scan",
      storeAsFaceVector: true,
    });
  });

  it("new user (different group and faceMap instead of vectors)", async () => {
    server.use(
      processRequestHandler({
        success: true,
        result: { livenessProven: true },
        didError: false,
        responseBlob: "mock-scan-result-blob",
      }),
      searchHandler([]),
    );

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
      faceSign: null,
      result: { livenessProven: true },
    });

    expect(agentSpy).toHaveBeenCalledWith("login-new-user", {
      identifier: response.body.faceSignUserId,
      groupName: "test-users",
    });

    // Verify FaceTec API calls
    const processRequest = requestCapture.getLastByEndpoint("/process-request");
    expect(processRequest?.body).toMatchObject({
      externalDatabaseRefID: response.body.faceSignUserId,
      requestBlob: "test-face-scan",
      storeAsFaceVector: false,
    });
  });

  it("failing liveness", async () => {
    server.use(
      processRequestHandler({
        success: false,
        result: { livenessProven: false },
        didError: true,
        responseBlob: "mock-scan-result-blob",
      }),
    );

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
  });

  it("duplicate (normal)", async () => {
    const resultId = crypto.randomUUID();

    server.use(
      processRequestHandler({
        success: true,
        result: { livenessProven: true },
        didError: false,
        responseBlob: "mock-scan-result-blob",
      }),
      searchHandler([{ identifier: resultId, matchLevel: 15 }]),
    );

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
      faceSign: null,
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

    server.use(
      processRequestHandler({
        success: true,
        result: { livenessProven: true },
        didError: false,
        responseBlob: "mock-scan-result-blob",
      }),
      searchHandler([
        { identifier: resultId, matchLevel: 15 },
        { identifier: resultId2, matchLevel: 15 },
      ]),
    );

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
  });
});
