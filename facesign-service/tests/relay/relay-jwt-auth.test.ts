import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../server.ts";
import { makeRelayBearerToken } from "../utils/helper.ts";
import { sessionStartHandler } from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("Relay JWT auth (max token age)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a valid ES512 token when iat is older than 10 minutes", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = makeRelayBearerToken("relay-test", { iat: nowSec - 11 * 60 });

    const response = await request(app)
      .post("/relay/liveness")
      .set({ Authorization: `Bearer ${token}` })
      .send({ requestBlob: "test-face-scan" });

    expect(response.status).toBe(401);
    expect(response.body.errorMessage).toBe("Bearer token is too old.");
  });

  it("accepts a token whose iat is exactly 10 minutes before now (boundary)", async () => {
    server.use(sessionStartHandler("mock-session-result-blob"));

    const nowSec = Math.floor(Date.now() / 1000);
    const token = makeRelayBearerToken("relay-test", { iat: nowSec - 10 * 60 });

    const response = await request(app)
      .post("/relay/liveness")
      .set({ Authorization: `Bearer ${token}` })
      .send({ requestBlob: "test-face-scan" });

    expect(response.status).toBe(200);
  });
});
