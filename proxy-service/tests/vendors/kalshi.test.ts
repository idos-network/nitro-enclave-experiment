import { constants, verify } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, arm, resetMocks, upstream, upstreamJson } from "../app.ts";
import { armBody, hostJws, KALSHI_KEY_PAIR, KALSHI_PRIVATE_KEY_PEM } from "../helpers.ts";

describe("kalshi", () => {
  beforeEach(resetMocks);

  it("signs a call with RSA-PSS over timestamp + method + path (no query)", async () => {
    const path = "/trade-api/v2/isv/users/status/u1?verbose=1";
    const id = await arm(
      armBody({
        api: "kalshi",
        environment: "sandbox",
        // Literal \n as the portal stores it must work too.
        auth: { apiKeyId: "key-1", privateKeyPem: KALSHI_PRIVATE_KEY_PEM.replace(/\n/g, "\\n") },
        allow: [{ method: "GET", path: "/trade-api/v2/isv/users/status/:id" }],
      }),
    );
    const jws = await hostJws({ method: "GET", path });
    upstream().mockResolvedValueOnce(upstreamJson(200, { last_step: "kyc-approved" }));

    await request(app).get(`/proxy/${id}${path}`).set("Authorization", `Bearer ${jws}`).expect(200);

    const [url, init] = upstream().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://external-api.demo.kalshi.co${path}`);
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
});
