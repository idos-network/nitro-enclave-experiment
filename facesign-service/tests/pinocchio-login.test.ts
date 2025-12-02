// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../providers/agent.ts";
import * as facetecApi from "../providers/api.ts";

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
  it("new user", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: true,
      result: { livenessProven: true },
      responseBlob: "mock-scan-result-blob",
      didError: false,
    } as any);

    const enrollUserSpy = vi.spyOn(facetecApi, "enrollUser").mockResolvedValue({
      success: true,
    });

    const vectorConvertSpy = vi.spyOn(facetecApi, "convertToVector").mockResolvedValue({
      success: true,
    });

    const duplicateSpy = vi.spyOn(facetecApi, "searchForDuplicates").mockResolvedValue({
      success: true,
      results: [],
    });

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/pinocchio").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(200);
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

    expect(duplicateSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "facesign-users");

    expect(enrollmentSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "test-face-scan");
    expect(vectorConvertSpy).toHaveBeenCalledWith(response.body.faceSignUserId);
    expect(enrollUserSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "facesign-users");

    expect(agentSpy).toHaveBeenCalledWith("pinocchio-new-user", {
      identifier: response.body.faceSignUserId,
    });

    expect(insertMemberSpy).toHaveBeenCalledWith("facesign-users", response.body.faceSignUserId);
  });

  it("failing liveness", async () => {
    vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: false,
      result: { livenessProven: true },
      responseBlob: "invalid-response-blob",
      didError: true,
    } as any);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/pinocchio").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      success: false,
      didError: true,
      responseBlob: "invalid-response-blob",
      result: { livenessProven: true },
    });

    expect(agentSpy).toHaveBeenCalledWith("pinocchio-enrollment-failed", {
      success: false,
      didError: true,
      error: undefined,
      result: { livenessProven: true },
    });
  });

  it("duplicate (normal)", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: true,
      result: { livenessProven: true },
      responseBlob: "mock-scan-result-blob",
      didError: false,
    } as any);

    const enrollUserSpy = vi.spyOn(facetecApi, "enrollUser").mockResolvedValue({
      success: true,
    });

    const resultId = crypto.randomUUID();

    const duplicateSpy = vi.spyOn(facetecApi, "searchForDuplicates").mockResolvedValue({
      success: true,
      results: [{ identifier: resultId, matchLevel: 15 }],
    });

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const oldestSpy = vi.spyOn(db, "getOldestFaceSignUserId").mockResolvedValue(resultId);

    const response = await request(app).post("/pinocchio").send({
      requestBlob: "test-face-scan",
    });

    // Verify the JWT token
    const decoded = jwt.verify(response.body.token, publicKey, { algorithms: ["ES512"] });
    expect(decoded.sub).toBe(resultId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      faceSignUserId: resultId,
      responseBlob: "mock-scan-result-blob",
      success: true,
      didError: false,
      result: { livenessProven: true },
      token: expect.any(String),
    });

    expect(duplicateSpy).toHaveBeenCalledWith(expect.any(String), "facesign-users");

    expect(enrollmentSpy).toHaveBeenCalledWith(expect.any(String), "test-face-scan");

    expect(enrollUserSpy).not.toHaveBeenCalled();

    expect(oldestSpy).toHaveBeenCalledWith([resultId]);

    expect(agentSpy).toHaveBeenCalledWith("pinocchio-duplicate", {
      count: 1,
      identifiers: [resultId],
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
  });

  it("duplicate (more than 1, choose oldest)", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: true,
      result: { livenessProven: true },
      responseBlob: "mock-scan-result-blob",
      didError: false,
    } as any);

    const enrollUserSpy = vi.spyOn(facetecApi, "enrollUser").mockResolvedValue({
      success: true,
    });

    const resultId = crypto.randomUUID();
    const resultId2 = crypto.randomUUID();
    const resultId3 = crypto.randomUUID();

    const duplicateSpy = vi.spyOn(facetecApi, "searchForDuplicates").mockResolvedValue({
      success: true,
      results: [
        { identifier: resultId, matchLevel: 15 },
        { identifier: resultId2, matchLevel: 15 },
        { identifier: resultId3, matchLevel: 15 },
      ],
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

    expect(response.status).toBe(200);
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

    expect(duplicateSpy).toHaveBeenCalledWith(expect.any(String), "facesign-users");

    expect(enrollmentSpy).toHaveBeenCalledWith(expect.any(String), "test-face-scan");

    expect(enrollUserSpy).not.toHaveBeenCalled();

    expect(agentSpy).toBeCalledWith("pinocchio-duplicate", {
      count: 3,
      identifiers: [resultId, resultId2, resultId3],
    });

    expect(oldestSpy).toHaveBeenCalledWith([resultId, resultId2, resultId3]);

    expect(insertMemberSpy).not.toHaveBeenCalled();
  });
});
