import { createPrivateKey } from "node:crypto";
import { pathToRegexp } from "path-to-regexp";
import { z } from "zod";

function compiles(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

export const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const CommonArmSchema = z.object({
  hostPublicKey: z.base64url().min(43).max(44), // base64url-encoded 32-byte Ed25519 public key (JWK `x`)
  // Origin only: the upstream URL is then plain `new URL(path, baseUrl)` with no prefix juggling.
  baseUrl: z
    .url({ protocol: /^https$/ })
    .refine((url) => new URL(url).href === `${new URL(url).origin}/`, {
      message: "baseUrl must be an origin without path, query or hash",
    }),
  allow: z
    .array(
      z.object({
        method: z.enum(ALLOWED_METHODS),
        // Express 5 route syntax (path-to-regexp), e.g. /api/identifications/:id
        path: z
          .string()
          .startsWith("/")
          .refine((path) => compiles(() => pathToRegexp(path)), {
            message: "Not a valid route pattern",
          }),
      }),
    )
    .min(1),
});

// One variant per vendor: `api` picks the adapter in providers/vendors.ts,
// `auth` holds whatever that adapter needs to authorize an upstream call.
const ApiKeyAuthSchema = z.object({ apiKey: z.string().min(1) });

const PrivateKeyPemSchema = z
  .string()
  // Portal/DB may store literal "\n" instead of real newlines.
  .transform((pem) => pem.replace(/\\n/g, "\n"))
  .refine((pem) => compiles(() => createPrivateKey(pem)), {
    message: "Not a valid PEM private key",
  });

export const ArmRequestSchema = z.discriminatedUnion("api", [
  CommonArmSchema.extend({ api: z.literal("iron"), auth: ApiKeyAuthSchema }),
  CommonArmSchema.extend({ api: z.literal("moonpay"), auth: ApiKeyAuthSchema }),
  CommonArmSchema.extend({ api: z.literal("persona"), auth: ApiKeyAuthSchema }),
  CommonArmSchema.extend({
    api: z.literal("sumsub"),
    auth: z.object({ appToken: z.string().min(1), secretKey: z.string().min(1) }),
  }),
  CommonArmSchema.extend({
    api: z.literal("kalshi"),
    auth: z.object({ apiKeyId: z.string().min(1), privateKeyPem: PrivateKeyPemSchema }),
  }),
  // No upstream: answers locally after `delayMs` (load testing without a real vendor).
  CommonArmSchema.extend({
    api: z.literal("mock"),
    auth: z.object({
      apiKey: z.string().min(1),
      delayMs: z.number().int().min(0).max(60_000).default(200),
    }),
  }),
]);

export type ArmRequest = z.infer<typeof ArmRequestSchema>;
export type Api = ArmRequest["api"];
