import tweetnacl from "tweetnacl";
import { BASE_URL, SIGNING_KEY_KMS_KEY_ID } from "../env.ts";
import type { CreateSessionRequest } from "../utils/dto.ts";
import { storeSession } from "./db.ts";
import { sign } from "./kms.ts";

export async function createSession(data: CreateSessionRequest) {
  // 1. Generate unique Session ID
  const sessionId = crypto.randomUUID();

  // 2. Generate Ephemeral X25519 Encryption Keys
  const sessionServerKeyPair = tweetnacl.box.keyPair();
  const sessionServerPublicKey = {
    kty: "OKP",
    crv: "X25519",
    x: Buffer.from(sessionServerKeyPair.publicKey).toString("base64url"),
  };

  // 3. JWS protected header (RFC 7515)
  const protectedBase64Url = Buffer.from(
    JSON.stringify({
      kid: SIGNING_KEY_KMS_KEY_ID,
      alg: "EdDSA",
      iss: BASE_URL,
      jku: `${BASE_URL}/.well-known/jwks.json`,
    }),
  ).toString("base64url");

  // 4. Payload — nonce salts the signature so identical keys don't fingerprint
  const payloadBase64Url = Buffer.from(
    JSON.stringify({
      sessionServerPublicKeyX: sessionServerPublicKey.x,
      nonce: crypto.randomUUID(),
    }),
  ).toString("base64url");

  // 5. Signing input: base64url(header) + "." + base64url(payload)
  const signingInputBuffer = Buffer.from(`${protectedBase64Url}.${payloadBase64Url}`, "utf-8");

  // 6. Sign via KMS
  const rawSignature = await sign(signingInputBuffer);
  const signatureBase64Url = Buffer.from(rawSignature).toString("base64url");
  const jwtChain = `${protectedBase64Url}.${payloadBase64Url}.${signatureBase64Url}`;

  // 7. Save ephemeral private state securely
  await storeSession(
    sessionId,
    sessionServerKeyPair,
    data.sessionClientPublicKey,
    jwtChain,
    data.allowedAudienceRoots,
  );

  return {
    id: sessionId,
    jwtChain: `${protectedBase64Url}.${payloadBase64Url}.${signatureBase64Url}`,
    sessionServerPublicKey,
  };
}
