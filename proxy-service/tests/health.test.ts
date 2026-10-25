import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, resetMocks } from "./app.ts";

describe("health", () => {
  beforeEach(resetMocks);

  it("GET / and /health", async () => {
    await request(app).get("/").expect(200).expect({ message: "Proxy Service is running" });

    await request(app).get("/health").expect(200).expect({ status: "ok" });
  });

  it("does not expose the enclave-service session endpoints", async () => {
    await request(app).post("/session").send({}).expect(404);
    await request(app).get("/.well-known/jwks.json").expect(404);
    expect.assertions(0);
  });
});
