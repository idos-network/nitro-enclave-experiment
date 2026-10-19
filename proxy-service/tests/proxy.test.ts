import { constants, createHash, createHmac, verify } from "node:crypto";
import { jwtVerify } from "jose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, arm, resetMocks, upstream } from "./app.ts";
import {
  armBody,
  BASE_URL,
  bodySha256,
  HOST_KEY_PAIR,
  hostJws,
  KALSHI_KEY_PAIR,
  KALSHI_PRIVATE_KEY_PEM,
  OTHER_HOST_KEY_PAIR,
} from "./helpers.ts";

const IDENT_PATH = "/api/identifications/ident-123";

function upstreamJson(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

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

  it("authorizes a moonpay call with x-api-key", async () => {
    const path = "/platform/v1/customers/cus_1";
    const id = await arm(
      armBody({
        api: "moonpay",
        baseUrl: "https://api.moonpay.example.com",
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
    expect(url).toBe(`https://api.moonpay.example.com${path}`);
    expect(new Headers(init.headers).get("x-api-key")).toBe("moonpay-secret");
  });

  it("signs a kalshi call with RSA-PSS over timestamp + method + path (no query)", async () => {
    const path = "/trade-api/v2/isv/users/status/u1?verbose=1";
    const id = await arm(
      armBody({
        api: "kalshi",
        baseUrl: "https://api.kalshi.example.com",
        // Literal \n as the portal stores it must work too.
        auth: { apiKeyId: "key-1", privateKeyPem: KALSHI_PRIVATE_KEY_PEM.replace(/\n/g, "\\n") },
        allow: [{ method: "GET", path: "/trade-api/v2/isv/users/status/:id" }],
      }),
    );
    const jws = await hostJws({ method: "GET", path });
    upstream().mockResolvedValueOnce(upstreamJson(200, { last_step: "kyc-approved" }));

    await request(app).get(`/proxy/${id}${path}`).set("Authorization", `Bearer ${jws}`).expect(200);

    const [, init] = upstream().mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    const timestamp = headers.get("kalshi-access-timestamp") ?? "";
    expect(headers.get("kalshi-access-key")).toBe("key-1");
    expect(Math.abs(Number(timestamp) - Date.now())).toBeLessThan(5_000);

    const preSign = `${timestamp}GET/trade-api/v2/isv/users/status/u1`;
    const ok = verify(
      "sha256",
      Buffer.from(preSign),
      {
        key: KALSHI_KEY_PAIR.publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(headers.get("kalshi-access-signature") ?? "", "base64"),
    );
    expect(ok).toBe(true);
  });

  it("authorizes a persona call with a bearer api key and forwards the version headers", async () => {
    const path = "/api/v1/inquiries/inq_1";
    const id = await arm(
      armBody({
        api: "persona",
        baseUrl: "https://api.withpersona.com",
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

    const [, init] = upstream().mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer persona-secret");
    expect(headers.get("persona-version")).toBe("2023-01-05");
    expect(headers.get("key-inflection")).toBe("camel");
  });

  it("signs a sumsub call with HMAC over ts + method + path?query + raw body", async () => {
    const path = "/resources/applicants?levelName=basic%2B1";
    const body = JSON.stringify({ externalUserId: "u-1", levelName: "basic+1" });
    const id = await arm(
      armBody({
        api: "sumsub",
        baseUrl: "https://api.sumsub.com",
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

  it("mock vendor answers locally after delayMs with a body hash and an HS256 JWT", async () => {
    const path = "/load/echo?n=1";
    const body = JSON.stringify({ hello: "world" });
    const id = await arm(
      armBody({
        api: "mock",
        baseUrl: "https://mock.invalid",
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
