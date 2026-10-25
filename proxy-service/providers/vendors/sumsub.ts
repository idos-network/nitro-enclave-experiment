import { createHmac } from "node:crypto";
import { z } from "zod";
import type { UpstreamCall, Vendor } from "./vendor.ts";

const SumsubAuthSchema = z.object({ appToken: z.string().min(1), secretKey: z.string().min(1) });
type SumsubAuth = z.output<typeof SumsubAuthSchema>;

/**
 * Sumsub request signing: HMAC-SHA256(secretKey, ts + METHOD + path?query + raw body), hex.
 * `pathname + search` is exactly the request target fetch puts on the wire, which is what
 * Sumsub verifies against. One host; sandbox tokens are prefixed `sbx:`.
 */
export class Sumsub implements Vendor<typeof SumsubAuthSchema> {
  readonly auth = SumsubAuthSchema;
  readonly origins = {
    production: "https://api.sumsub.com",
    sandbox: "https://api.sumsub.com",
  };

  async authorize(auth: SumsubAuth, call: UpstreamCall) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const hmac = createHmac("sha256", auth.secretKey).update(
      `${ts}${call.method.toUpperCase()}${call.url.pathname}${call.url.search}`,
    );
    if (call.body) hmac.update(call.body);

    return {
      "X-App-Token": auth.appToken,
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": hmac.digest("hex"),
    };
  }
}
