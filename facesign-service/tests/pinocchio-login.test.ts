// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    readFileSync: vi.fn(() => privateKey),
  };
});

// Mock modules before importing the app
vi.mock("../providers/db.ts", () => ({
  insertMember: vi.fn(),
  countMembersInGroup: vi.fn(),
  getMembers: vi.fn(),
  getOldestFaceSignUserId: vi.fn(),
}));

import { ObjectId } from "mongodb";
import * as db from "../providers/db.ts";
import app from "../server.ts";

describe("Pinocchio Login API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("return new session", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        responseBlob: "mock-session-result-blob",
      }),
    } as any);

    const response = await request(app).post("/pinocchio").send({
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

    const response = await request(app).post("/pinocchio").send({
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

    const response = await request(app).post("/pinocchio").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      success: true,
      token: expect.any(String),
    });

    // Verify the JWT token
    const decoded = jwt.verify(response.body.token, publicKey, { algorithms: ["ES512"] });
    expect(decoded.sub).toBe(response.body.faceSignUserId);

    // Enrollment spy
    const processRequestCall = spyFetch.mock.calls.find((call) =>
      call[0].toString().endsWith("/process-request"),
    );
    expect(processRequestCall).toBeDefined();
    expect(JSON.parse(processRequestCall?.[1]?.body as string)).toMatchObject({
      externalDatabaseRefID: response.body.faceSignUserId,
      storeAsVector: false,
      requestBlob: "test-face-scan",
    });

    // Search 3d-db duplicate spy
    const duplicateCall = spyFetch.mock.calls.find((call) =>
      call[0].toString().endsWith("3d-db/search"),
    );
    expect(duplicateCall).toBeDefined();
    expect(JSON.parse(duplicateCall?.[1]?.body as string)).toMatchObject({
      externalDatabaseRefID: response.body.faceSignUserId,
      groupName: "pinocchio-users",
      minMatchLevel: 15,
    });

    expect(agentSpy).toHaveBeenCalledWith("pinocchio-new-user", {
      identifier: response.body.faceSignUserId,
    });

    expect(insertMemberSpy).toHaveBeenCalledWith("pinocchio-users", response.body.faceSignUserId);
  });

  it("failing liveness", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
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

    const response = await request(app).post("/pinocchio").send({
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

    expect(agentSpy).toHaveBeenCalledWith("pinocchio-enrollment-failed", {
      success: false,
      didError: true,
      error: undefined,
      result: { livenessProven: false },
    });
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

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});
    const oldestSpy = vi.spyOn(db, "getOldestFaceSignUserId").mockResolvedValue(resultId);

    const response = await request(app).post("/pinocchio").send({
      requestBlob: "test-face-scan",
    });

    // Verify the JWT token
    const decoded = jwt.verify(response.body.token, publicKey, { algorithms: ["ES512"] });
    expect(decoded.sub).toBe(resultId);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      faceSignUserId: resultId,
      responseBlob: "mock-scan-result-blob",
      success: true,
      didError: false,
      result: { livenessProven: true },
      token: expect.any(String),
    });

    expect(oldestSpy).toHaveBeenCalledWith([resultId]);

    expect(agentSpy).toHaveBeenCalledWith("pinocchio-duplicate", {
      count: 1,
      identifiers: [resultId],
    });

    expect(db.insertMember).not.toHaveBeenCalled();
  });

  it("duplicate (more than 1, choose oldest)", async () => {
    const resultId = crypto.randomUUID();
    const resultId2 = crypto.randomUUID();
    const resultId3 = crypto.randomUUID();

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
              { identifier: resultId3, matchLevel: 15 },
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

    const oldestSpy = vi.spyOn(db, "getOldestFaceSignUserId").mockResolvedValue(resultId3);

    const response = await request(app).post("/pinocchio").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      faceSignUserId: resultId3, // 3 is the oldest
      responseBlob: "mock-scan-result-blob",
      success: true,
      result: { livenessProven: true },
      didError: false,
      token: expect.any(String),
    });

    // Verify the JWT token
    const decoded = jwt.verify(response.body.token, publicKey, { algorithms: ["ES512"] });
    expect(decoded.sub).toBe(resultId3);

    const duplicateRequestCall = spyFetch.mock.calls.find((call) =>
      call[0].toString().endsWith("3d-db/search"),
    );
    expect(duplicateRequestCall).toBeDefined();
    // @ts-expect-error This is fine for tests
    expect(JSON.parse(duplicateRequestCall?.[1]?.body ?? "{}")).toMatchObject({
      externalDatabaseRefID: expect.any(String),
      groupName: "pinocchio-users",
      minMatchLevel: 15,
    });

    expect(db.insertMember).not.toHaveBeenCalled();

    expect(agentSpy).toBeCalledWith("pinocchio-duplicate", {
      count: 3,
      identifiers: [resultId, resultId2, resultId3],
    });

    expect(oldestSpy).toHaveBeenCalledWith([resultId, resultId2, resultId3]);
    expect(insertMemberSpy).not.toHaveBeenCalled();
  });
});
