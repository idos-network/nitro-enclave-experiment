// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
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

import { ObjectId } from "mongodb";
import * as db from "../providers/db.ts";

import app from "../server.ts";

describe("Login API", () => {
  it("return new session", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      responseBlob: "mock-session-result-blob",
    } as any);

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(200);
    expect(response.body.responseBlob).toBe("mock-session-result-blob");
    expect(enrollmentSpy).toHaveBeenCalledWith(expect.any(String), "test-face-scan");
  });

  it("new user", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: true,
      result: { livenessProven: true },
      didError: false,
      responseBlob: "mock-scan-result-blob",
    } as any);

    const enrollUserSpy = vi.spyOn(facetecApi, "enrollUser").mockResolvedValue({
      success: true,
    });

    const convertToVectorSpy = vi.spyOn(facetecApi, "convertToVector").mockResolvedValue({
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

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      success: true,
    });

    expect(duplicateSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "facesign-users");

    expect(enrollmentSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "test-face-scan");

    expect(enrollUserSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "facesign-users");

    expect(agentSpy).toHaveBeenCalledWith("login-new-user", {
      identifier: response.body.faceSignUserId,
      groupName: "facesign-users",
    });

    expect(insertMemberSpy).toHaveBeenCalledWith("facesign-users", response.body.faceSignUserId);
    expect(convertToVectorSpy).toHaveBeenCalledWith(response.body.faceSignUserId);
  });

  it("new user (different group and faceMap instead of vectors)", async () => {
    const enrollmentSpy = vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: true,
      didError: false,
      result: { livenessProven: true },
      responseBlob: "mock-scan-result-blob",
    } as any);

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

    const convertToVectorSpy = vi.spyOn(facetecApi, "convertToVector").mockResolvedValue({
      success: true,
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
      groupName: "test-users",
      faceVector: false,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      success: true,
      result: { livenessProven: true },
    });

    expect(duplicateSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "test-users");
    expect(enrollmentSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "test-face-scan");

    expect(enrollUserSpy).toHaveBeenCalledWith(response.body.faceSignUserId, "test-users");

    expect(agentSpy).toHaveBeenCalledWith("login-new-user", {
      identifier: response.body.faceSignUserId,
      groupName: "test-users",
    });
    expect(insertMemberSpy).toHaveBeenCalledWith("test-users", response.body.faceSignUserId);
    expect(convertToVectorSpy).not.toHaveBeenCalled();
  });

  it("failing liveness", async () => {
    vi.spyOn(facetecApi, "enrollment3d").mockResolvedValue({
      success: false,
      result: { livenessProven: true },
      didError: true,
      responseBlob: "",
    } as any);

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      success: false,
      didError: true,
      result: { livenessProven: true },
      responseBlob: "",
    });

    expect(agentSpy).toHaveBeenCalledWith("login-enrollment-failed", {
      success: false,
      result: {
        livenessProven: true,
      },
      didError: true,
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

    const vectorConvertSpy = vi.spyOn(facetecApi, "convertToVector").mockResolvedValue({
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

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      faceSignUserId: resultId,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      success: true,
      didError: false,
    });

    expect(duplicateSpy).toHaveBeenCalledWith(expect.any(String), "facesign-users");

    expect(enrollmentSpy).toHaveBeenCalledWith(expect.any(String), "test-face-scan");
    expect(enrollUserSpy).not.toHaveBeenCalled();

    expect(agentSpy).toHaveBeenCalledWith("login-duplicate", {
      count: 1,
      identifiers: [resultId],
      groupName: "facesign-users",
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
    expect(vectorConvertSpy).toHaveBeenCalledWith(expect.any(String));
  });

  it("duplicate (error)", async () => {
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

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      didError: true,
      errorMessage:
        "Login process failed, check server logs: Multiple users found with the same face-vector.",
      success: false,
    });

    expect(duplicateSpy).toHaveBeenCalledWith(expect.any(String), "facesign-users");
    expect(enrollmentSpy).toHaveBeenCalledWith(expect.any(String), "test-face-scan");

    expect(enrollUserSpy).not.toHaveBeenCalled();

    expect(agentSpy).toBeCalledWith("login-duplicate-error", {
      count: 2,
      identifiers: [resultId, resultId2],
      groupName: "facesign-users",
    });

    expect(agentSpy).toHaveBeenCalledWith("login-error", {
      message: "Multiple users found with the same face-vector.",
      stack: expect.any(String),
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
  });
});
