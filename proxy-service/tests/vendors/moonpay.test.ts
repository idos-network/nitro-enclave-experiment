import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, arm, resetMocks, upstream, upstreamJson } from "../app.ts";
import { armBody, hostJws } from "../helpers.ts";

describe("moonpay", () => {
  beforeEach(resetMocks);

  it("authorizes a call with x-api-key", async () => {
    const path = "/platform/v1/customers/cus_1";
    const id = await arm(
      armBody({
        api: "moonpay",
        environment: "sandbox",
        auth: { apiKey: "moonpay-secret" },
        allow: [{ method: "GET", path: "/platform/v1/customers/:id" }],
      }),
    );
    const jws = await hostJws({ method: "GET", path });
    upstream().mockResolvedValueOnce(upstreamJson(200, { data: { id: "cus_1" } }));

    const res = await request(app)
      .get(`/proxy/${id}${path}`)
      .set("Authorization", `Bearer ${jws}`)
      .expect(200);

    expect(res.body).toEqual({ data: { id: "cus_1" } });
    const [url, init] = upstream().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.moonpay.com${path}`);
    expect(new Headers(init.headers).get("x-api-key")).toBe("moonpay-secret");
  });
});
