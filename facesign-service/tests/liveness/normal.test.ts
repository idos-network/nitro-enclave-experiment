// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any

import { ObjectId } from "mongodb";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../../providers/agent.ts";
import * as db from "../../providers/db.ts";
import app from "../../server.ts";
import { relayAuthorizationHeader } from "../utils/helper.ts";
import {
  processRequestErrorHandler,
  processRequestHandler,
  requestCapture,
  searchHandler,
  sessionStartHandler,
} from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("Liveness API", () => {
  it("return new session", async () => {
    server.use(sessionStartHandler("mock-session-result-blob"));

    const response = await request(app)
      .post("/relay/liveness")
      .set(relayAuthorizationHeader())
      .send({
        requestBlob: "test-face-scan",
      });

    expect(response.status).toBe(200);
    expect(response.body.responseBlob).toBe("mock-session-result-blob");
    expect(response.body.sessionStart).toBe(true);
  });

  it("fail with error", async () => {
    server.use(processRequestErrorHandler(500, "Server error"));

    const response = await request(app)
      .post("/relay/liveness")
      .set(relayAuthorizationHeader())
      .send({
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

  it("new user (just liveness)", async () => {
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

    const response = await request(app)
      .post("/relay/liveness")
      .set(relayAuthorizationHeader())
      .send({
        requestBlob: "test-face-scan",
        storeSelfie: true,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      success: true,
      userId: expect.any(String),
      selfieImageId: expect.any(String),
    });

    // New user audit trail image ID should be the same as userId
    expect(response.body.selfieImageId).toBe(response.body.userId);

    expect(agentSpy).toHaveBeenCalledWith("liveness-request", {
      userId: response.body.userId,
      faceVector: true,
      onboardFaceSign: false,
      storeSelfie: true,
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();

    // Verify FaceTec API calls
    const processRequest = requestCapture.getLastByEndpoint("/process-request");
    expect(processRequest?.body).toMatchObject({
      externalDatabaseRefID: response.body.userId,
      requestBlob: "test-face-scan",
      storeAsFaceVector: true,
      storeAuditTrailImages: true,
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

    const response = await request(app)
      .post("/relay/liveness")
      .set(relayAuthorizationHeader())
      .send({
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

    expect(agentSpy).toHaveBeenCalledWith("enrollment3d-recoverable-error", {
      success: false,
      launchId: expect.any(String),
      error: "Liveness check or enrollment 3D failed and was not processed.",
      result: {
        livenessProven: false,
      },
      didError: true,
    });
  });

  it("returns 401 without bearer token", async () => {
    const response = await request(app).post("/relay/liveness").send({
      requestBlob: "test-face-scan",
    });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ errorMessage: "Missing or invalid Authorization header." });
  });

  it("returns 401 for invalid bearer token", async () => {
    const response = await request(app)
      .post("/relay/liveness")
      .set({ Authorization: "Bearer not-a-jwt" })
      .send({ requestBlob: "test-face-scan" });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ errorMessage: "Invalid or expired bearer token." });
  });
});
