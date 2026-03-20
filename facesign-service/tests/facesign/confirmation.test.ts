// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import { generateKeyPairSync } from "node:crypto";
import { ObjectId } from "mongodb";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import * as db from "../../providers/db.ts";
import app from "../../server.ts";
import { GROUP_NAME, makeNewUserConfirmationToken } from "../utils/helper.ts";
import { requestCapture, searchHandler } from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("FaceSign/Confirmation API", () => {
  it("missing token", async () => {
    const response = await request(app).post("/facesign/confirmation").send({});

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toBe("Invalid or expired token");
  });

  it("token signed with different key", async () => {
    const wrongPrivateKey = generateKeyPairSync("ec", {
      namedCurve: "secp521r1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;

    const token = makeNewUserConfirmationToken({
      sub: "test-user-id",
      action: "facesign-confirmation",
      key: wrongPrivateKey,
    });

    const response = await request(app).post("/facesign/confirmation").send({
      newUserConfirmationToken: token,
    });

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toBe("Invalid or expired token");
  });

  it("expired token", async () => {
    const token = makeNewUserConfirmationToken({
      sub: "test-user-id",
      action: "confirmation",
      iat: Math.floor(Date.now() / 1000) - 120, // 2 minutes ago
    });

    const response = await request(app).post("/facesign/confirmation").send({
      newUserConfirmationToken: token,
    });

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toBe("Token already expired");
  });

  it("user is already onboarded", async () => {
    const userId = "test-user-id-already-onboarded";

    server.use(searchHandler([{ identifier: "different-user-id", matchLevel: 15 }]));

    const token = makeNewUserConfirmationToken({
      sub: userId,
      action: "confirmation",
    });

    const response = await request(app).post("/facesign/confirmation").send({
      newUserConfirmationToken: token,
    });

    expect(response.status).toBe(409);
    expect(response.body.errorMessage).toBe("User already exists");
  });

  it("everything ok", async () => {
    const userId = crypto.randomUUID();

    server.use(searchHandler([]));

    const token = makeNewUserConfirmationToken({
      sub: userId,
      action: "confirmation",
    });

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const response = await request(app).post("/facesign/confirmation").send({
      newUserConfirmationToken: token,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      faceSignUserId: userId,
      userAttestmentToken: expect.any(String),
    });

    expect(insertMemberSpy).toHaveBeenCalledWith({ groupName: GROUP_NAME, faceSignUserId: userId });

    // Verify FaceTec API calls
    const enrollRequest = requestCapture.getLastByEndpoint("/3d-db/enroll");
    expect(enrollRequest?.body).toMatchObject({
      externalDatabaseRefID: userId,
      groupName: GROUP_NAME,
    });
  });
});
