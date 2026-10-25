import { pathToRegexp } from "path-to-regexp";
import { z } from "zod";
import { ENVIRONMENTS, vendors } from "../providers/vendors/index.ts";
import { compiles } from "./compiles.ts";

export const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const CommonArmSchema = z.object({
  hostPublicKey: z.base64url().min(43).max(44), // base64url-encoded 32-byte Ed25519 public key (JWK `x`)
  // Picks the vendor origin from its adapter; the host never supplies a URL.
  environment: z.enum(ENVIRONMENTS),
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

// One variant per vendor: `api` picks the adapter, `auth` is whatever that adapter validates.
export const ArmRequestSchema = z.discriminatedUnion("api", [
  CommonArmSchema.extend({ api: z.literal("iron"), auth: vendors.iron.auth }),
  CommonArmSchema.extend({ api: z.literal("moonpay"), auth: vendors.moonpay.auth }),
  CommonArmSchema.extend({ api: z.literal("persona"), auth: vendors.persona.auth }),
  CommonArmSchema.extend({ api: z.literal("sumsub"), auth: vendors.sumsub.auth }),
  CommonArmSchema.extend({ api: z.literal("kalshi"), auth: vendors.kalshi.auth }),
  CommonArmSchema.extend({ api: z.literal("mock"), auth: vendors.mock.auth }),
]);

export type ArmRequest = z.infer<typeof ArmRequestSchema>;
