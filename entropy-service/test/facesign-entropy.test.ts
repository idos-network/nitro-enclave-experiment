import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import * as loggerContext from "../utils/logger-context.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "secp521r1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

vi.mock("fs", async () => {
  const actualFs = await vi.importActual<typeof import("fs")>("fs");

  return {
    ...actualFs,
    readFileSync: vi.fn(() => publicKey),
  };
});

// Mock modules before importing the app
vi.mock("../providers/db.ts", () => ({
  fetchOrCreateFaceSignEntropy: vi.fn(),
}));

import * as db from "../providers/db.ts";

import app from "../server.ts";

describe("FaceSign Entropy API", () => {
  it("missing token", async () => {
    const response = await request(app).post("/facesign/entropy").send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Token is required" });
  });

  it("new user no entropy", async () => {
    const entropySpy = vi.spyOn(db, "fetchOrCreateFaceSignEntropy").mockResolvedValue({
      insert: true,
      entropy: "mock test entropy",
    });

    const userId = crypto.randomUUID();
    const token = jwt.sign(
      {
        sub: userId,
      },
      privateKey,
      {
        algorithm: "ES512",
      },
    );

    const writeLogSpy = vi.spyOn(loggerContext, "writeLog");

    const response = await request(app).post("/facesign/entropy").send({
      token,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      faceSignUserId: userId,
      entropy: "mock test entropy",
    });

    expect(entropySpy).toHaveBeenCalledWith(userId);
    expect(writeLogSpy).toHaveBeenCalledWith("entropy_request");
    expect(writeLogSpy).toHaveBeenCalledWith("entropy_created", {
      userId,
      ip: expect.any(String),
    });
  });

  it("user with existing entropy", async () => {
    const entropySpy = vi.spyOn(db, "fetchOrCreateFaceSignEntropy").mockResolvedValue({
      insert: false,
      entropy: "mock test entropy",
    });

    const userId = crypto.randomUUID();
    const token = jwt.sign(
      {
        sub: userId,
      },
      privateKey,
      {
        algorithm: "ES512",
      },
    );

    const writeLogSpy = vi.spyOn(loggerContext, "writeLog");

    const response = await request(app).post("/facesign/entropy").send({
      token,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      faceSignUserId: userId,
      entropy: "mock test entropy",
    });

    expect(entropySpy).toHaveBeenCalledWith(userId);
    expect(writeLogSpy).toHaveBeenCalledWith("entropy_request");
    expect(writeLogSpy).toHaveBeenCalledWith("entropy_fetched", {
      userId,
      ip: expect.any(String),
    });
  });

  it("invalid token", async () => {
    const writeLogSpy = vi.spyOn(loggerContext, "writeLog");

    const response = await request(app).post("/facesign/entropy").send({
      token: "invalid-token",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid token" });

    expect(writeLogSpy).toHaveBeenCalledWith("entropy_request");
    expect(writeLogSpy).toHaveBeenCalledWith("entropy_error_invalid_token", {
      error: expect.any(Error),
    });
  });

  it("expired token", async () => {
    const userId = crypto.randomUUID();
    const token = jwt.sign(
      {
        sub: userId,
        iat: Math.floor(Date.now() / 1000) - 60, // Issued 60 seconds ago
      },
      privateKey,
      {
        algorithm: "ES512",
      },
    );

    const writeLogSpy = vi.spyOn(loggerContext, "writeLog");

    const response = await request(app).post("/facesign/entropy").send({
      token,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Token already expired" });

    expect(writeLogSpy).toHaveBeenCalledWith("entropy_request");
    expect(writeLogSpy).toHaveBeenCalledWith("entropy_error_too_old", {
      iat: expect.any(Number),
      now: expect.any(Number),
    });
  });
});
