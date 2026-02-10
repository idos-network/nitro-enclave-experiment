// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import request from "supertest";
import agent from "../../providers/agent.ts";
import * as db from "../../providers/db.ts";
import app from "../../server.ts";
import { GROUP_NAME, publicKey } from "../utils/helper.ts";
import {
  processRequestErrorHandler,
  processRequestHandler,
  requestCapture,
  searchHandler,
  sessionStartHandler,
} from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("FaceSign/Login API", () => {
  it("return new session", async () => {
    server.use(sessionStartHandler("mock-session-result-blob"));

    const response = await request(app).post("/facesign").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(200);
    expect(response.body.responseBlob).toBe("mock-session-result-blob");
    expect(response.body.sessionStart).toBe(true);
  });

  it("fail with error", async () => {
    server.use(processRequestErrorHandler(500, "Server error"));

    const response = await request(app).post("/facesign").send({
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

    const response = await request(app).post("/facesign").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      success: true,
      newUser: true,
      confirmationToken: expect.any(String),
    });

    // Verify the JWT token
    const decoded = jwt.verify(response.body.confirmationToken, publicKey, {
      algorithms: ["ES512"],
    });
    expect(decoded.sub).toBe(response.body.faceSignUserId);

    expect(agentSpy).toHaveBeenCalledWith("facesign-user-pending-confirmation", {
      faceSignUserId: response.body.faceSignUserId,
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();

    // Verify FaceTec API calls
    const processRequest = requestCapture.getLastByEndpoint("/process-request");
    expect(processRequest?.body).toMatchObject({
      externalDatabaseRefID: response.body.faceSignUserId,
      requestBlob: "test-face-scan",
    });

    const searchRequest = requestCapture.getLastByEndpoint("/3d-db/search");
    expect(searchRequest?.body).toMatchObject({
      externalDatabaseRefID: response.body.faceSignUserId,
      groupName: GROUP_NAME,
      minMatchLevel: 15,
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

    const response = await request(app).post("/facesign").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      success: false,
      didError: true,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: false },
    });

    expect(agentSpy).toHaveBeenCalledWith("facesign-enrollment-failed", {
      success: false,
      didError: true,
      error: undefined,
      result: { livenessProven: false },
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

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});
    const oldestSpy = vi.spyOn(db, "getOldestFaceSignUserId").mockResolvedValue(resultId);

    const response = await request(app).post("/facesign").send({
      requestBlob: "test-face-scan",
    });

    // Verify the JWT token
    const decoded = jwt.verify(response.body.entropyToken, publicKey, { algorithms: ["ES512"] });
    expect(decoded.sub).toBe(resultId);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      faceSignUserId: resultId,
      responseBlob: "mock-scan-result-blob",
      success: true,
      didError: false,
      newUser: false,
      result: { livenessProven: true },
      entropyToken: expect.any(String),
    });

    expect(oldestSpy).not.toHaveBeenCalledWith([resultId]);

    expect(agentSpy).toHaveBeenCalledWith("facesign-duplicate", {
      count: 1,
      currentUserId: expect.any(String),
      identifiers: [resultId],
    });

    expect(db.insertMember).not.toHaveBeenCalled();
  });

  it("duplicate (more than 1, choose oldest)", async () => {
    const resultId = crypto.randomUUID();
    const resultId2 = crypto.randomUUID();
    const resultId3 = crypto.randomUUID();

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
        { identifier: resultId3, matchLevel: 15 },
      ]),
    );

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const oldestSpy = vi.spyOn(db, "getOldestFaceSignUserId").mockResolvedValue(resultId3);

    const response = await request(app).post("/facesign").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      faceSignUserId: resultId3, // 3 is the oldest
      responseBlob: "mock-scan-result-blob",
      success: true,
      result: { livenessProven: true },
      didError: false,
      newUser: false,
      entropyToken: expect.any(String),
    });

    // Verify the JWT token
    const decoded = jwt.verify(response.body.entropyToken, publicKey, { algorithms: ["ES512"] });
    expect(decoded.sub).toBe(resultId3);

    expect(db.insertMember).not.toHaveBeenCalled();

    expect(agentSpy).toBeCalledWith("facesign-duplicate", {
      count: 3,
      currentUserId: expect.any(String),
      identifiers: [resultId, resultId2, resultId3],
    });

    expect(oldestSpy).toHaveBeenCalledWith([resultId, resultId2, resultId3]);
    expect(insertMemberSpy).not.toHaveBeenCalled();

    // Verify FaceTec API calls
    const searchRequest = requestCapture.getLastByEndpoint("/3d-db/search");
    expect(searchRequest?.body).toMatchObject({
      externalDatabaseRefID: expect.any(String),
      groupName: GROUP_NAME,
      minMatchLevel: 15,
    });
  });
});
