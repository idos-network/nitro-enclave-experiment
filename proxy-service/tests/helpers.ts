import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import type { ArmRequest } from "../utils/dto.ts";

export const ARM_TOKEN = "arm-token-two";
export const BASE_URL = "https://iron.example.com";

export const HOST_KEY_PAIR = generateKeyPairSync("ed25519");
export const KALSHI_KEY_PAIR = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const KALSHI_PRIVATE_KEY_PEM = KALSHI_KEY_PAIR.privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();
export const OTHER_HOST_KEY_PAIR = generateKeyPairSync("ed25519");

export function publicKeyB64(keyPair: { publicKey: KeyObject }): string {
  // Raw 32-byte Ed25519 public key is the JWK `x` coordinate.
  return keyPair.publicKey.export({ format: "jwk" }).x as string;
}

// Loose overrides: a Partial of a discriminated union cannot be spread type-safely.
export function armBody(overrides: Record<string, unknown> = {}): ArmRequest {
  return {
    api: "iron",
    hostPublicKey: publicKeyB64(HOST_KEY_PAIR),
    baseUrl: BASE_URL,
    auth: { apiKey: "iron-secret" },
    allow: [
      { method: "GET", path: "/api/identifications/:id" },
      { method: "POST", path: "/api/customers/:id/identifications/v2" },
    ],
    ...overrides,
  } as ArmRequest;
}

export function bodySha256(body?: string | Buffer): string {
  return createHash("sha256")
    .update(body ?? "")
    .digest("base64url");
}

export async function hostJws(
  claims: { method: string; path: string; body?: string | Buffer },
  keyPair: { privateKey: KeyObject } = HOST_KEY_PAIR,
  expiresIn = "2m",
): Promise<string> {
  return new SignJWT({
    method: claims.method,
    path: claims.path,
    bodySha256: bodySha256(claims.body),
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(keyPair.privateKey);
}
