import { createHmac } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, arm, resetMocks, upstream, upstreamJson } from "../app.ts";
import { armBody, hostJws } from "../helpers.ts";

describe("sumsub", () => {
  beforeEach(resetMocks);

  it("signs a call with HMAC over ts + method + path?query + raw body", async () => {
    const path = "/resources/applicants?levelName=basic%2B1";
    const body = JSON.stringify({ externalUserId: "u-1", levelName: "basic+1" });
    const id = await arm(
      armBody({
        api: "sumsub",
        environment: "sandbox",
        auth: { appToken: "sbx:app-token", secretKey: "sumsub-secret" },
        allow: [{ method: "POST", path: "/resources/applicants" }],
      }),
    );
    const jws = await hostJws({ method: "POST", path, body });
    upstream().mockResolvedValueOnce(upstreamJson(201, { id: "app_1" }));

    await request(app)
      .post(`/proxy/${id}${path}`)
      .set("Authorization", `Bearer ${jws}`)
      .set("Content-Type", "application/json")
      .send(body)
      .expect(201);

    const [url, init] = upstream().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.sumsub.com${path}`);
    const headers = new Headers(init.headers);
    const ts = headers.get("x-app-access-ts") ?? "";
    expect(headers.get("x-app-token")).toBe("sbx:app-token");
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(5);

    const expected = createHmac("sha256", "sumsub-secret")
      .update(`${ts}POST${path}`)
      .update(body)
      .digest("hex");
    expect(headers.get("x-app-access-sig")).toBe(expected);
  });
});
