// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import request from "supertest";
import agent from "../../providers/agent.ts";
import * as db from "../../providers/db.ts";
import app from "../../server.ts";
import { publicKey, relayAuthorizationHeader } from "../utils/helper.ts";
import {
  processRequestHandler,
  searchHandler,
  searchHandlerWithBodyCheck,
} from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("Liveness + Facesign Onboarding API", () => {
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

    const response = await request(app)
      .post("/relay/liveness")
      .set(relayAuthorizationHeader())
      .send({
        requestBlob: "test-face-scan",
        faceVector: false,
        onboardFaceSign: true,
        groupName: "facesign-users",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      userId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      faceSign: {
        newUser: true,
        userId: expect.any(String),
        userAttestmentToken: expect.any(String),
      },
      launchId: expect.any(String),
      success: true,
    });

    // User IDs should match
    expect(response.body.userId).toBe(response.body.faceSign.userId);

    // Check only faceSign stuff
    expect(agentSpy).toHaveBeenCalledWith("group-resolution-new-user-enrolled", {
      groupName: "pinocchio-users",
      userId: response.body.userId,
      process: "facesign",
      launchId: expect.any(String),
    });

    expect(insertMemberSpy).toHaveBeenCalledWith({
      groupName: "pinocchio-users",
      userId: response.body.userId,
    });

    // Check jwt
    const decoded = jwt.verify(response.body.faceSign.userAttestmentToken, publicKey, {
      algorithms: ["ES512"],
    }) as { sub: string; iat: number };

    expect(decoded.sub).toBe(response.body.faceSign.userId);
  });

  it("existing user", async () => {
    server.use(
      processRequestHandler({
        success: true,
        result: { livenessProven: true },
        didError: false,
        responseBlob: "mock-scan-result-blob",
      }),
      // Return existing user only for pinocchio-users group (facesign), empty for others (login)
      searchHandlerWithBodyCheck(
        (body) => body.groupName === "pinocchio-users",
        [{ identifier: "existing-user-id", matchLevel: 15 }],
        [],
      ),
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
        onboardFaceSign: true,
        faceVector: false,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      userId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      faceSign: {
        newUser: false,
        userId: "existing-user-id",
        userAttestmentToken: expect.any(String),
      },
      launchId: expect.any(String),
      success: true,
    });

    // User IDs should not match
    expect(response.body.userId).not.toBe(response.body.faceSign.userId);

    // Check only faceSign stuff
    expect(agentSpy).toHaveBeenCalledWith("group-resolution-existing-user", {
      matchedUserIds: ["existing-user-id"],
      groupName: "pinocchio-users",
      process: "facesign",
      resolvedUserId: "existing-user-id",
      userId: response.body.userId,
      launchId: expect.any(String),
      count: 1,
    });

    expect(insertMemberSpy).not.toHaveBeenCalled();

    // Check jwt
    const decoded = jwt.verify(response.body.faceSign.userAttestmentToken, publicKey, {
      algorithms: ["ES512"],
    }) as { sub: string; iat: number };

    expect(decoded.sub).toBe("existing-user-id");
  });
});
