import { createHash } from "node:crypto";
import { jwtVerify } from "jose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, arm, resetMocks, upstream } from "../app.ts";
import { armBody, bodySha256, hostJws } from "../helpers.ts";

describe("mock", () => {
  beforeEach(resetMocks);

  it("answers locally after delayMs with a body hash and an HS256 JWT", async () => {
    const path = "/load/echo?n=1";
    const body = JSON.stringify({ hello: "world" });
    const id = await arm(
      armBody({
        api: "mock",
        environment: "sandbox",
        auth: { apiKey: "mock-secret", delayMs: 20 },
        allow: [{ method: "POST", path: "/load/echo" }],
      }),
    );
    const jws = await hostJws({ method: "POST", path, body });

    const started = Date.now();
    const res = await request(app)
      .post(`/proxy/${id}${path}`)
      .set("Authorization", `Bearer ${jws}`)
      .set("Content-Type", "application/json")
      .send(body)
      .expect(200);

    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    expect(upstream()).not.toHaveBeenCalled();
    expect(res.body.method).toBe("POST");
    expect(res.body.path).toBe(path);
    expect(res.body["X-Body-Sha256"]).toBe(bodySha256(body));

    const { payload } = await jwtVerify(
      res.body.Authorization.replace("Bearer ", ""),
      createHash("sha256").update("mock-secret").digest(),
      { algorithms: ["HS256"] },
    );
    expect(payload).toMatchObject({
      method: "POST",
      path: "/load/echo",
      bodySha256: bodySha256(body),
    });
  });
});
