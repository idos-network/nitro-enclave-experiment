import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

export const GROUP_NAME = "pinocchio-users";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "secp521r1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const { privateKey: relayPrivateKey, publicKey: relayPublicKey } = generateKeyPairSync("ec", {
  namedCurve: "secp521r1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

type TokenOptions = {
  sub: string;
  action?: string;
  iat?: number;
  key?: string | Buffer;
};

export function makeNewUserConfirmationToken({
  sub,
  action = "confirmation",
  iat = Math.floor(Date.now() / 1000),
  key = privateKey,
}: TokenOptions) {
  return jwt.sign({ sub, action, iat }, key, { algorithm: "ES512" });
}

/** ES512 JWT for `Authorization: Bearer` on `/relay/*` (sign with private key; service verifies with public). */
export function makeRelayBearerToken(sub = "relay-test", opts?: { iat?: number }) {
  const payload: { sub: string; iat?: number } = { sub };
  if (opts?.iat !== undefined) {
    payload.iat = opts.iat;
  }
  return jwt.sign(payload, relayPrivateKey, { algorithm: "ES512", expiresIn: "1h" });
}

export function relayAuthorizationHeader() {
  return { Authorization: `Bearer ${makeRelayBearerToken()}` };
}

export { privateKey, publicKey, relayPrivateKey, relayPublicKey };
