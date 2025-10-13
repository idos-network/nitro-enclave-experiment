import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../providers/agent.ts";
import * as facetecApi from "../providers/api.ts";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "secp521r1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

vi.mock('fs', async () => {
  const actualFs = await vi.importActual<typeof import('fs')>('fs');

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
}));

import { ObjectId } from "mongodb";
import * as db from "../providers/db.ts";

import app from "../server.ts";

describe("Login API", () => {
  it("new user", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: true,
      wasProcessed: true,
      scanResultBlob: "mock-scan-result-blob",
    });

    const enrollUserSpy = vi.spyOn(facetecApi, "enrollUser").mockResolvedValue({
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

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => { });

    const response = await request(app).post("/login").send({
      faceScan: "test-face-scan",
      key: "test-key",
      userAgent: "test-user-agent",
      auditTrailImage: "test-audit-trail-image",
      lowQualityAuditTrailImage: "test-low-quality-audit-trail-image",
      sessionId: "test-session-id",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      error: false,
      faceSignUserId: expect.any(String),
      scanResultBlob: "mock-scan-result-blob",
      success: true,
      wasProcessed: true,
      token: expect.any(String),
    });

    // Verify the JWT token
    const decoded = jwt.verify(response.body.token, publicKey, { algorithms: ['ES512'] })
    expect(decoded.sub).toBe(response.body.faceSignUserId);

    expect(duplicateSpy).toHaveBeenCalledWith(
      response.body.faceSignUserId,
      "test-key",
      "facesign-users",
      "test-user-agent",
    );

    expect(enrollmentSpy).toHaveBeenCalledWith(
      response.body.faceSignUserId,
      "test-face-scan",
      "test-audit-trail-image",
      "test-low-quality-audit-trail-image",
      "test-key",
      "test-user-agent",
      "test-session-id",
    );
    expect(enrollUserSpy).toHaveBeenCalledWith(
      response.body.faceSignUserId,
      "facesign-users",
      "test-key",
    );
    expect(agentSpy).toHaveBeenCalledWith("new-user", {
      identifier: response.body.faceSignUserId,
    });
    expect(insertMemberSpy).toHaveBeenCalledWith("facesign-users", response.body.faceSignUserId);
  });

  it("failing liveness", async () => {
    vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: false,
      wasProcessed: true,
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => { });

    const response = await request(app).post("/login").send({
      faceScan: "test-face-scan",
      key: "test-key",
      userAgent: "test-user-agent",
      auditTrailImage: "test-audit-trail-image",
      lowQualityAuditTrailImage: "test-low-quality-audit-trail-image",
      sessionId: "test-session-id",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      success: false,
      wasProcessed: true,
    });

    expect(agentSpy).toHaveBeenCalledWith("enrollment-failed", {
      success: false,
      wasProcessed: true,
      error: undefined,
    });
  });

  it("duplicate (normal)", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: true,
      wasProcessed: true,
      scanResultBlob: "mock-scan-result-blob",
    });

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

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => { });

    const response = await request(app).post("/login").send({
      faceScan: "test-face-scan",
      key: "test-key",
      userAgent: "test-user-agent",
      auditTrailImage: "test-audit-trail-image",
      lowQualityAuditTrailImage: "test-low-quality-audit-trail-image",
      sessionId: "test-session-id",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      error: false,
      faceSignUserId: resultId,
      scanResultBlob: "mock-scan-result-blob",
      success: true,
      wasProcessed: true,
      token: expect.any(String),
    });

    expect(duplicateSpy).toHaveBeenCalledWith(
      expect.any(String),
      "test-key",
      "facesign-users",
      "test-user-agent",
    );
    expect(enrollmentSpy).toHaveBeenCalledWith(
      expect.any(String),
      "test-face-scan",
      "test-audit-trail-image",
      "test-low-quality-audit-trail-image",
      "test-key",
      "test-user-agent",
      "test-session-id",
    );
    expect(enrollUserSpy).not.toHaveBeenCalled();

    expect(agentSpy).toHaveBeenCalledWith("duplicate", {
      count: 1,
      identifiers: [resultId],
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
  });

  it("duplicate (error)", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: true,
      wasProcessed: true,
      scanResultBlob: "mock-scan-result-blob",
    });

    const enrollUserSpy = vi.spyOn(facetecApi, "enrollUser").mockResolvedValue({
      success: true,
    });

    const resultId = crypto.randomUUID();
    const resultId2 = crypto.randomUUID();

    const duplicateSpy = vi.spyOn(facetecApi, "searchForDuplicates").mockResolvedValue({
      success: true,
      results: [
        { identifier: resultId, matchLevel: 15 },
        { identifier: resultId2, matchLevel: 15 },
      ],
    });

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => { });

    const response = await request(app).post("/login").send({
      faceScan: "test-face-scan",
      key: "test-key",
      userAgent: "test-user-agent",
      auditTrailImage: "test-audit-trail-image",
      lowQualityAuditTrailImage: "test-low-quality-audit-trail-image",
      sessionId: "test-session-id",
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: true,
      errorMessage:
        "Login process failed, check server logs: Multiple users found with the same face-vector.",
      success: false,
      wasProcessed: false,
    });

    expect(duplicateSpy).toHaveBeenCalledWith(
      expect.any(String),
      "test-key",
      "facesign-users",
      "test-user-agent",
    );
    expect(enrollmentSpy).toHaveBeenCalledWith(
      expect.any(String),
      "test-face-scan",
      "test-audit-trail-image",
      "test-low-quality-audit-trail-image",
      "test-key",
      "test-user-agent",
      "test-session-id",
    );
    expect(enrollUserSpy).not.toHaveBeenCalled();

    expect(agentSpy).toBeCalledWith("duplicate-error", {
      count: 2,
      identifiers: [resultId, resultId2],
    });

    expect(agentSpy).toHaveBeenCalledWith("error", {
      message: "Multiple users found with the same face-vector.",
      stack: expect.any(String),
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
  });
});
