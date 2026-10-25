import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, arm, resetMocks, upstream, upstreamJson } from "../app.ts";
import { armBody, hostJws } from "../helpers.ts";

describe("persona", () => {
  beforeEach(resetMocks);

  it("authorizes a call with a bearer api key and forwards the version headers", async () => {
    const path = "/api/v1/inquiries/inq_1";
    const id = await arm(
      armBody({
        api: "persona",
        environment: "sandbox",
        auth: { apiKey: "persona-secret" },
        allow: [{ method: "GET", path: "/api/v1/inquiries/:id" }],
      }),
    );
    const jws = await hostJws({ method: "GET", path });
    upstream().mockResolvedValueOnce(upstreamJson(200, { data: { id: "inq_1" } }));

    await request(app)
      .get(`/proxy/${id}${path}`)
      .set("Authorization", `Bearer ${jws}`)
      .set("Persona-Version", "2023-01-05")
      .set("Key-Inflection", "camel")
      .expect(200);

    const [url, init] = upstream().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.withpersona.com${path}`);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer persona-secret");
    expect(headers.get("persona-version")).toBe("2023-01-05");
    expect(headers.get("key-inflection")).toBe("camel");
  });
});
