import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, resetMocks } from "./app.ts";
import { SIGNING_PUBLIC_KEY_JWK } from "./helpers.ts";

describe("health + JWKS", () => {
  beforeEach(resetMocks);

  it("GET / and /health", async () => {
    await request(app).get("/").expect(200).expect({ message: "Enclave Service is running" });

    await request(app).get("/health").expect(200).expect({ status: "ok" });
  });

  it("GET /.well-known/jwks.json publishes the current, then the previous key", async () => {
    const res = await request(app).get("/.well-known/jwks.json").expect(200);

    expect(res.body.keys[0]).toEqual(SIGNING_PUBLIC_KEY_JWK);
    expect(res.body.keys).toHaveLength(2);
    expect(res.body.keys[1].kid).not.toBe(SIGNING_PUBLIC_KEY_JWK.kid);
  });
});
