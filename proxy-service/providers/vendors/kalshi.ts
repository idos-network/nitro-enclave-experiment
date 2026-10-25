import { constants, createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import { compiles } from "../../utils/compiles.ts";
import type { UpstreamCall, Vendor } from "./vendor.ts";

const PrivateKeyPemSchema = z
  .string()
  // Portal/DB may store literal "\n" instead of real newlines.
  .transform((pem) => pem.replace(/\\n/g, "\n"))
  .refine((pem) => compiles(() => createPrivateKey(pem)), {
    message: "Not a valid PEM private key",
  });

const KalshiAuthSchema = z.object({
  apiKeyId: z.string().min(1),
  privateKeyPem: PrivateKeyPemSchema,
});
type KalshiAuth = z.output<typeof KalshiAuthSchema>;

/**
 * Kalshi API-key request signing:
 * pre_sign = timestamp_ms + HTTP_METHOD + REQUEST_PATH (no host, no query)
 * signature = base64(RSA-PSS-SHA256(pre_sign, private_key, salt_length = DIGEST_LENGTH))
 */
export class Kalshi implements Vendor<typeof KalshiAuthSchema> {
  readonly auth = KalshiAuthSchema;
  readonly origins = {
    production: "https://external-api.kalshi.com",
    sandbox: "https://external-api.demo.kalshi.co",
  };

  async authorize(auth: KalshiAuth, call: UpstreamCall) {
    const timestampMs = Date.now().toString();
    const preSign = `${timestampMs}${call.method.toUpperCase()}${call.url.pathname}`;
    const signature = sign("sha256", Buffer.from(preSign), {
      key: auth.privateKeyPem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    });

    return {
      "KALSHI-ACCESS-KEY": auth.apiKeyId,
      "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
      "KALSHI-ACCESS-TIMESTAMP": timestampMs,
    };
  }
}
