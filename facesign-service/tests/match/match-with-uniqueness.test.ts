// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any

import { ObjectId } from "mongodb";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../../providers/agent.ts";
import * as db from "../../providers/db.ts";
import app from "../../server.ts";
import { relayAuthorizationHeader } from "../utils/helper.ts";
import { processRequestHandler, requestCapture, searchHandler } from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("Match API (+ uniqueness)", () => {
  it("user match (level 15) + uniqueness (new user)", async () => {
    server.use(
      processRequestHandler({
        success: true,
        result: { livenessProven: true, matchLevel: 15 },
        didError: false,
        responseBlob: "mock-scan-result-blob",
      }),
      searchHandler([]),
    );

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const response = await request(app).post("/relay/match").set(relayAuthorizationHeader()).send({
      requestBlob: "test-face-scan",
      userId: "test-user-id",
      storeSelfie: true,
      groupName: "test-users",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true, matchLevel: 15 },
      success: true,
      launchId: expect.any(String),
      selfieImageId: expect.any(String),
      groupResolution: {
        userId: "test-user-id",
        newUser: true,
      },
    });

    expect(agentSpy).toHaveBeenCalledWith("match-request", {
      userId: "test-user-id",
      storeSelfie: true,
      groupName: "test-users",
    });

    expect(agentSpy).toHaveBeenCalledWith("match-3d-3d-done", {
      identifier: "test-user-id",
      matchLevel: 15,
      launchId: expect.any(String),
      selfieImageId: expect.any(String),
    });

    expect(agentSpy).toHaveBeenCalledWith("group-resolution-new-user-enrolled", {
      userId: "test-user-id",
      groupName: "test-users",
      launchId: expect.any(String),
      process: "uniqueness",
    });

    // Verify FaceTec API calls
    const processRequest = requestCapture.getLastByEndpoint("/process-request");
    expect(processRequest?.body).toMatchObject({
      externalDatabaseRefID: "test-user-id",
      requestBlob: "test-face-scan",
    });

    const searchRequest = requestCapture.getLastByEndpoint("/3d-db/search");
    expect(searchRequest?.body).toMatchObject({
      externalDatabaseRefID: "test-user-id",
      groupName: "test-users",
    });

    expect(insertMemberSpy).toHaveBeenCalledWith({
      groupName: "test-users",
      userId: "test-user-id",
    });
  });

  it("user match (level 15) + uniqueness (existing user)", async () => {
    server.use(
      processRequestHandler({
        success: true,
        result: { livenessProven: true, matchLevel: 15 },
        didError: false,
        responseBlob: "mock-scan-result-blob",
      }),
      searchHandler([{ identifier: "test-user-id2", matchLevel: 15 }]),
    );

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const response = await request(app).post("/relay/match").set(relayAuthorizationHeader()).send({
      requestBlob: "test-face-scan",
      userId: "test-user-id",
      storeSelfie: true,
      groupName: "test-users",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true, matchLevel: 15 },
      success: true,
      launchId: expect.any(String),
      selfieImageId: expect.any(String),
      groupResolution: {
        userId: "test-user-id2",
        newUser: false,
      },
    });

    expect(agentSpy).toHaveBeenCalledWith("match-request", {
      userId: "test-user-id",
      storeSelfie: true,
      groupName: "test-users",
    });

    expect(agentSpy).toHaveBeenCalledWith("match-3d-3d-done", {
      identifier: "test-user-id",
      matchLevel: 15,
      launchId: expect.any(String),
      selfieImageId: expect.any(String),
    });

    expect(agentSpy).toHaveBeenCalledWith("group-resolution-existing-user", {
      userId: "test-user-id",
      count: 1,
      groupName: "test-users",
      launchId: expect.any(String),
      matchedUserIds: ["test-user-id2"],
      resolvedUserId: "test-user-id2",
      process: "uniqueness",
    });

    // Verify FaceTec API calls
    const processRequest = requestCapture.getLastByEndpoint("/process-request");
    expect(processRequest?.body).toMatchObject({
      externalDatabaseRefID: "test-user-id",
      requestBlob: "test-face-scan",
    });

    const searchRequest = requestCapture.getLastByEndpoint("/3d-db/search");
    expect(searchRequest?.body).toMatchObject({
      externalDatabaseRefID: "test-user-id",
      groupName: "test-users",
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
  });

  it("user match (level 15) + uniqueness (FFR)", async () => {
    server.use(
      processRequestHandler({
        success: true,
        result: { livenessProven: true, matchLevel: 15 },
        didError: false,
        responseBlob: "mock-scan-result-blob",
      }),
      searchHandler([
        { identifier: "test-user-id2", matchLevel: 15 },
        { identifier: "test-user-id3", matchLevel: 15 },
        { identifier: "test-user-id4", matchLevel: 15 },
      ]),
    );

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const response = await request(app).post("/relay/match").set(relayAuthorizationHeader()).send({
      requestBlob: "test-face-scan",
      userId: "test-user-id",
      storeSelfie: true,
      groupName: "test-users",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      errorMessage: "Enrollment process failed, multiple users found with the same face-vector.",
    });

    expect(agentSpy).toHaveBeenCalledWith("match-request", {
      userId: "test-user-id",
      storeSelfie: true,
      groupName: "test-users",
    });

    expect(agentSpy).toHaveBeenCalledWith("match-3d-3d-done", {
      identifier: "test-user-id",
      matchLevel: 15,
      launchId: expect.any(String),
      selfieImageId: expect.any(String),
    });

    expect(agentSpy).toHaveBeenCalledWith("group-resolution-ffr-rejected", {
      userId: "test-user-id",
      count: 3,
      groupName: "test-users",
      launchId: expect.any(String),
      matchedUserIds: ["test-user-id2", "test-user-id3", "test-user-id4"],
      process: "uniqueness",
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();
  });
});
