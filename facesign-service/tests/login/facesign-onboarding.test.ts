// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import request from "supertest";
import agent from "../../providers/agent.ts";
import * as db from "../../providers/db.ts";
import app from "../../server.ts";
import { publicKey } from "../utils/helper.ts";
import {
  processRequestHandler,
  searchHandler,
  searchHandlerWithBodyCheck,
} from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("Login/Facesign Onboarding API", () => {
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

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
      faceVector: false,
      onboardFaceSign: true,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      faceSign: {
        newUser: true,
        faceSignUserId: expect.any(String),
        entropyToken: expect.any(String),
      },
      success: true,
    });

    // User IDs should match
    expect(response.body.faceSignUserId).toBe(response.body.faceSign.faceSignUserId);

    // Check only faceSign stuff
    expect(agentSpy).toHaveBeenCalledWith("facesign-new-user", {
      identifier: response.body.faceSignUserId,
    });

    expect(insertMemberSpy).toHaveBeenCalledWith("facesign-users", response.body.faceSignUserId);

    // Check jwt
    const decoded = jwt.verify(response.body.faceSign.entropyToken, publicKey, {
      algorithms: ["ES512"],
    }) as { sub: string; iat: number };

    expect(decoded.sub).toBe(response.body.faceSign.faceSignUserId);
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
        [{ identifier: "existing-user-id", matchLevel: 90 }],
        [],
      ),
    );

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
      faceVector: false,
      onboardFaceSign: true,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      faceSign: {
        newUser: false,
        faceSignUserId: "existing-user-id",
        entropyToken: expect.any(String),
      },
      success: true,
    });

    // User IDs should match
    expect(response.body.faceSignUserId).not.toBe(response.body.faceSign.faceSignUserId);

    // Check only faceSign stuff
    expect(agentSpy).toHaveBeenCalledWith("facesign-duplicate", {
      identifiers: ["existing-user-id"],
      currentUserId: response.body.faceSignUserId,
      count: 1,
    });

    expect(insertMemberSpy).toHaveBeenCalledTimes(1);

    // Check jwt
    const decoded = jwt.verify(response.body.faceSign.entropyToken, publicKey, {
      algorithms: ["ES512"],
    }) as { sub: string; iat: number };

    expect(decoded.sub).toBe("existing-user-id");
  });
});
