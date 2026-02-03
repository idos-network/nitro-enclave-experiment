// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { privateKey } = generateKeyPairSync("ec", {
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

describe("FaceSign wallet Confirmation API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("missing token", async () => {
    const response = await request(app).post("/facesign-wallet/confirmation").send({});

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toBe("Invalid or expired token");
  });

  it("token signed with different key", async () => {
    const wrongPrivateKey = generateKeyPairSync("ec", {
      namedCurve: "secp521r1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;

    const token = jwt.sign(
      {
        sub: "test-user-id",
        action: "facesign-wallet-confirmation",
      },
      wrongPrivateKey,
      {
        algorithm: "ES512",
      },
    );

    const response = await request(app).post("/facesign-wallet/confirmation").send({
      confirmationToken: token,
    });

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toBe("Invalid or expired token");
  });

  it("expired token", async () => {
    const token = jwt.sign(
      {
        sub: "test-user-id",
        action: "confirmation",
        iat: Math.floor(Date.now() / 1000) - 120, // 2 minutes ago
      },
      privateKey,
      {
        algorithm: "ES512",
      },
    );

    const response = await request(app).post("/facesign-wallet/confirmation").send({
      confirmationToken: token,
    });

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toBe("Token already expired");
  });

  it("user is already onboarded", async () => {
    const userId = "test-user-id-already-onboarded";

    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url.toString().endsWith("3d-db/search")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            results: [{ identifier: "different-user-id", matchLevel: 15 }],
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

    const token = jwt.sign(
      {
        sub: userId,
        action: "confirmation",
        iat: Math.floor(Date.now() / 1000),
      },
      privateKey,
      {
        algorithm: "ES512",
      },
    );

    const response = await request(app).post("/facesign-wallet/confirmation").send({
      confirmationToken: token,
    });

    expect(response.status).toBe(409);
    expect(response.body.errorMessage).toBe("User already exists");
  });

  it("everything ok", async () => {
    const userId = crypto.randomUUID();

    const spyFetch = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
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

    const token = jwt.sign(
      {
        sub: userId,
        action: "confirmation",
        iat: Math.floor(Date.now() / 1000),
      },
      privateKey,
      {
        algorithm: "ES512",
      },
    );

    const insertMemberSpy = vi.spyOn(db, "insertMember").mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const response = await request(app).post("/facesign-wallet/confirmation").send({
      confirmationToken: token,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      faceSignUserId: userId,
      entropyToken: expect.any(String),
    });

    expect(insertMemberSpy).toHaveBeenCalledWith(userId, "facesign-wallet-users");

    // 3d-db/enroll
    const enrollCall = spyFetch.mock.calls.find((call) =>
      call[0].toString().endsWith("3d-db/enroll"),
    );
    expect(enrollCall).toBeDefined();
    expect(JSON.parse(enrollCall?.[1]?.body as string)).toMatchObject({
      externalDatabaseRefID: userId,
      groupName: "facesign-wallet-users",
    });
  });
});
