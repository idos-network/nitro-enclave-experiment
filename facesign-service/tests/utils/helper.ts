import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

export const GROUP_NAME = "pinocchio-users";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
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

export function makeConfirmationToken({
  sub,
  action = "confirmation",
  iat = Math.floor(Date.now() / 1000),
  key = privateKey,
}: TokenOptions) {
  return jwt.sign({ sub, action, iat }, key, { algorithm: "ES512" });
}


export { privateKey, publicKey };
