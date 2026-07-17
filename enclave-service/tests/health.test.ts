import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, getPublicKeyJWK, resetMocks } from "./app.ts";
import { SIGNING_PUBLIC_KEY_JWK } from "./helpers.ts";

describe("health + JWKS", () => {
  beforeEach(resetMocks);

  it("GET / and /health", async () => {
    await request(app).get("/").expect(200).expect({ message: "Enclave Service is running" });

    await request(app).get("/health").expect(200).expect({ status: "ok" });
  });

  it("GET /.well-known/jwks.json uses mocked KMS", async () => {
    const res = await request(app).get("/.well-known/jwks.json").expect(200);

    expect(getPublicKeyJWK()).toHaveBeenCalledOnce();
    expect(res.body).toEqual({
      keys: [SIGNING_PUBLIC_KEY_JWK],
    });
  });
});
