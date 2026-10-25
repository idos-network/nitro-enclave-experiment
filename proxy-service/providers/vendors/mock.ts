import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { z } from "zod";
import type { UpstreamCall, Vendor } from "./vendor.ts";

const MockAuthSchema = z.object({
  apiKey: z.string().min(1),
  delayMs: z.number().int().min(0).max(60_000).default(200),
});
type MockAuth = z.output<typeof MockAuthSchema>;

/**
 * Load-testing vendor with no upstream: answered locally in proxy.ts after `delayMs`, never
 * fetched. Does comparable CPU work to a real adapter (sha256 of the body, HS256 JWT keyed by
 * sha256(apiKey)).
 */
export class Mock implements Vendor<typeof MockAuthSchema> {
  readonly auth = MockAuthSchema;
  readonly origins = {
    production: "https://mock.invalid",
    sandbox: "https://mock.invalid",
  };

  async authorize(auth: MockAuth, call: UpstreamCall) {
    const bodySha256 = createHash("sha256")
      .update(call.body ?? "")
      .digest("base64url");
    const jwt = await new SignJWT({
      method: call.method.toUpperCase(),
      path: call.url.pathname,
      bodySha256,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .sign(createHash("sha256").update(auth.apiKey).digest());

    return { Authorization: `Bearer ${jwt}`, "X-Body-Sha256": bodySha256 };
  }
}
