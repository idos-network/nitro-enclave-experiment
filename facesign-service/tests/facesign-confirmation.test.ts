// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import { generateKeyPairSync } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GROUP_NAME,
  makeConfirmationToken,
  mock3dDbFetch,
} from "./utils/facesign-test-helpers.ts";

import { ObjectId } from "mongodb";
import * as db from "../providers/db.ts";
import app from "../server.ts";

describe("FaceSign Confirmation API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    const token = makeConfirmationToken({
      sub: "test-user-id",
      action: "facesign-confirmation",
      key: wrongPrivateKey,
    });

    const response = await request(app).post("/facesign/confirmation").send({
      confirmationToken: token,
    });

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toBe("Invalid or expired token");
  });

  it("expired token", async () => {
    const token = makeConfirmationToken({
      sub: "test-user-id",
      action: "confirmation",
      iat: Math.floor(Date.now() / 1000) - 120, // 2 minutes ago
    });

    const response = await request(app).post("/facesign/confirmation").send({
      confirmationToken: token,
    });

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toBe("Token already expired");
  });

  it("user is already onboarded", async () => {
    const userId = "test-user-id-already-onboarded";

    mock3dDbFetch({
      searchResults: [{ identifier: "different-user-id", matchLevel: 15 }],
    });

    const token = makeConfirmationToken({
      sub: userId,
      action: "confirmation",
    });

    const response = await request(app).post("/facesign/confirmation").send({
      confirmationToken: token,
    });

    expect(response.status).toBe(409);
    expect(response.body.errorMessage).toBe("User already exists");
  });

  it("everything ok", async () => {
    const userId = crypto.randomUUID();

    const spyFetch = mock3dDbFetch();

    const token = makeConfirmationToken({
      sub: userId,
      action: "confirmation",
    });

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const response = await request(app).post("/facesign/confirmation").send({
      confirmationToken: token,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      faceSignUserId: userId,
      entropyToken: expect.any(String),
    });

    expect(insertMemberSpy).toHaveBeenCalledWith(userId, GROUP_NAME);

    // 3d-db/enroll
    const enrollCall = spyFetch.mock.calls.find((call) =>
      call[0].toString().endsWith("3d-db/enroll"),
    );
    expect(enrollCall).toBeDefined();
    expect(JSON.parse(enrollCall?.[1]?.body as string)).toMatchObject({
      externalDatabaseRefID: userId,
      groupName: GROUP_NAME,
    });
  });
});
