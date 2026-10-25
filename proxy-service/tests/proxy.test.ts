import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, arm, resetMocks, upstream, upstreamJson } from "./app.ts";
import { BASE_URL, HOST_KEY_PAIR, hostJws, OTHER_HOST_KEY_PAIR } from "./helpers.ts";

const IDENT_PATH = "/api/identifications/ident-123";

describe("ANY /proxy/:id/*", () => {
  beforeEach(resetMocks);

  it("404 for an unknown armed id", async () => {
    const jws = await hostJws({ method: "GET", path: IDENT_PATH });

    await request(app)
      .get(`/proxy/${crypto.randomUUID()}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .expect(404);
  });

  it("401 without a host signature", async () => {
    const id = await arm();

    await request(app).get(`/proxy/${id}${IDENT_PATH}`).expect(401);
    expect(upstream()).not.toHaveBeenCalled();
  });

  it("401 when signed by a key other than the armed host key", async () => {
    const id = await arm();
    const jws = await hostJws({ method: "GET", path: IDENT_PATH }, OTHER_HOST_KEY_PAIR);

    await request(app)
      .get(`/proxy/${id}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .expect(401);
    expect(upstream()).not.toHaveBeenCalled();
  });

  it("401 when the signed path differs from the requested path", async () => {
    const id = await arm();
    const jws = await hostJws({ method: "GET", path: "/api/identifications/other" });

    await request(app)
      .get(`/proxy/${id}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .expect(401);
  });

  it("401 when the signed method differs from the requested method", async () => {
    const id = await arm();
    const jws = await hostJws({ method: "GET", path: IDENT_PATH });

    await request(app)
      .delete(`/proxy/${id}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .expect(401);
  });

  it("401 when the body does not match the signed body hash", async () => {
    const id = await arm();
    const path = "/api/customers/customer-1/identifications/v2";
    const jws = await hostJws({ method: "POST", path, body: JSON.stringify({ a: 1 }) });

    await request(app)
      .post(`/proxy/${id}${path}`)
      .set("Authorization", `Bearer ${jws}`)
      .set("Content-Type", "application/json")
      .send({ a: 2 })
      .expect(401);
    expect(upstream()).not.toHaveBeenCalled();
  });

  it("401 when the signature has expired", async () => {
    const id = await arm();
    const jws = await hostJws({ method: "GET", path: IDENT_PATH }, HOST_KEY_PAIR, "-1m");

    await request(app)
      .get(`/proxy/${id}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .expect(401);
  });

  it("403 when method + path are not in the allowlist", async () => {
    const id = await arm();
    const path = "/api/identifications/ident-123/archive";
    const jws = await hostJws({ method: "PUT", path });

    const res = await request(app)
      .put(`/proxy/${id}${path}`)
      .set("Authorization", `Bearer ${jws}`)
      .expect(403);

    expect(res.body.error).toMatch(/not allowed/i);
    expect(upstream()).not.toHaveBeenCalled();
  });

  it("forwards an allowed GET with the iron auth headers and passes the response through", async () => {
    const id = await arm();
    const jws = await hostJws({ method: "GET", path: IDENT_PATH });
    upstream().mockResolvedValueOnce(upstreamJson(200, { id: "ident-123", status: "Pending" }));

    const res = await request(app)
      .get(`/proxy/${id}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .set("IDEMPOTENCY-KEY", "idem-1")
      .set("X-API-Version", "2026-08-01")
      .expect(200);

    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ id: "ident-123", status: "Pending" });

    expect(upstream()).toHaveBeenCalledOnce();
    const [url, init] = upstream().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${IDENT_PATH}`);
    expect(init.method).toBe("GET");

    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("iron-secret");
    expect(headers.get("x-api-version")).toBe("2026-08-01");
    expect(headers.get("idempotency-key")).toBe("idem-1");
    // The host's proxy credential must never reach the vendor.
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("host")).toBeNull();
  });

  it("drops expect and the headers named by Connection", async () => {
    const id = await arm();
    const jws = await hostJws({ method: "GET", path: IDENT_PATH });
    upstream().mockResolvedValueOnce(upstreamJson(200, {}));

    await request(app)
      .get(`/proxy/${id}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .set("Expect", "100-continue")
      .set("Connection", "close, X-Hop")
      .set("X-Hop", "1")
      .set("X-Kept", "1")
      .expect(200);

    const [, init] = upstream().mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("expect")).toBeNull();
    expect(headers.get("x-hop")).toBeNull();
    expect(headers.get("x-kept")).toBe("1");
  });

  it("does not let the host override the vendor auth headers", async () => {
    const id = await arm();
    const jws = await hostJws({ method: "GET", path: IDENT_PATH });
    upstream().mockResolvedValueOnce(upstreamJson(200, {}));

    await request(app)
      .get(`/proxy/${id}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .set("X-API-Key", "spoofed")
      .expect(200);

    const [, init] = upstream().mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-api-key")).toBe("iron-secret");
  });

  it("forwards the raw body, query string and upstream error status", async () => {
    const id = await arm();
    const path = "/api/customers/customer-1/identifications/v2?dry_run=true";
    const body = JSON.stringify({ person: { first_name: "Jan" } });
    const jws = await hostJws({ method: "POST", path, body });
    upstream().mockResolvedValueOnce(upstreamJson(400, { code: "invalid_person" }));

    const res = await request(app)
      .post(`/proxy/${id}${path}`)
      .set("Authorization", `Bearer ${jws}`)
      .set("Content-Type", "application/json")
      .send(body)
      .expect(400);

    expect(res.body).toEqual({ code: "invalid_person" });

    const [url, init] = upstream().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${path}`);
    expect(init.method).toBe("POST");
    expect(Buffer.from(init.body as Uint8Array).toString()).toBe(body);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("502 when the upstream is unreachable", async () => {
    const id = await arm();
    const jws = await hostJws({ method: "GET", path: IDENT_PATH });
    upstream().mockRejectedValueOnce(new Error("ECONNRESET"));

    const res = await request(app)
      .get(`/proxy/${id}${IDENT_PATH}`)
      .set("Authorization", `Bearer ${jws}`)
      .expect(502);

    expect(res.body).toEqual({ error: "Upstream request failed" });
  });
});
