// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any

import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

// Mock modules before importing the app
vi.mock("../providers/db.ts", () => ({
  insertMember: vi.fn(),
  countMembersInGroup: vi.fn(),
  getMembers: vi.fn(),
}));

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

import agent from "../providers/agent.ts";
import * as db from "../providers/db.ts";
import app from "../server.ts";

describe("Login API (with facesign onboarding)", () => {
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

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
      faceVector: false,
      onboardFaceSignWallet: true,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      faceSignWallet: {
        newUser: true,
        faceSignUserId: expect.any(String),
        entropyToken: expect.any(String),
      },
      success: true,
    });

    // User IDs should match
    expect(response.body.faceSignUserId).toBe(response.body.faceSignWallet.faceSignUserId);

    // Check only faceSignWallet stuff
    expect(agentSpy).toHaveBeenCalledWith("facesign-wallet-new-user", {
      identifier: response.body.faceSignUserId,
    });

    expect(insertMemberSpy).toHaveBeenCalledWith(
      "facesign-wallet-users",
      response.body.faceSignUserId,
    );
    expect(spyFetch).toHaveBeenCalledTimes(5); // 3 login, 2 facesign wallet

    // Check jwt
    const decoded = jwt.verify(response.body.faceSignWallet.entropyToken, publicKey, {
      algorithms: ["ES512"],
    }) as { sub: string; iat: number };

    expect(decoded.sub).toBe(response.body.faceSignWallet.faceSignUserId);
  });

  it("existing user", async () => {
    const spyFetch = vi.spyOn(global, "fetch").mockImplementation(async (url, options) => {
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
        // @ts-expect-error This is fine for testing
        if (options?.body?.includes("facesign-wallet-users")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              results: [{ identifier: "existing-user-id", matchLevel: 90 }],
            }),
          } as any;
        }
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

    const response = await request(app).post("/login").send({
      requestBlob: "test-face-scan",
      faceVector: false,
      onboardFaceSignWallet: true,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      faceSignUserId: expect.any(String),
      responseBlob: "mock-scan-result-blob",
      result: { livenessProven: true },
      faceSignWallet: {
        newUser: false,
        faceSignUserId: "existing-user-id",
        entropyToken: expect.any(String),
      },
      success: true,
    });

    // User IDs should match
    expect(response.body.faceSignUserId).not.toBe(response.body.faceSignWallet.faceSignUserId);

    // Check only faceSignWallet stuff
    expect(agentSpy).toHaveBeenCalledWith("facesign-wallet-duplicate", {
      identifiers: ["existing-user-id"],
      currentUserId: response.body.faceSignUserId,
      count: 1,
    });

    expect(insertMemberSpy).toHaveBeenCalledTimes(1);
    expect(spyFetch).toHaveBeenCalledTimes(4); // 3 login, 1 facesign wallet

    // Check jwt
    const decoded = jwt.verify(response.body.faceSignWallet.entropyToken, publicKey, {
      algorithms: ["ES512"],
    }) as { sub: string; iat: number };

    expect(decoded.sub).toBe("existing-user-id");
  });
});
