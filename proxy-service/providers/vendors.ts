import { constants, createHash, createHmac, sign } from "node:crypto";
import { SignJWT } from "jose";
import type { Api, ArmRequest } from "../utils/dto.ts";

export interface UpstreamCall {
  method: string;
  url: URL;
  body: Buffer | undefined;
}

/** Headers that authorize `call` at the vendor, built from the armed `auth`. */
type Authorize<A extends Api> = (
  auth: Extract<ArmRequest, { api: A }>["auth"],
  call: UpstreamCall,
) => Promise<Record<string, string>>;

// X-API-Version is not a secret; the host sends it like any other header.
const iron: Authorize<"iron"> = async (auth) => ({ "X-API-Key": auth.apiKey });

const moonpay: Authorize<"moonpay"> = async (auth) => ({ "x-api-key": auth.apiKey });

// Persona-Version and Key-Inflection are not secrets; the host sends them.
const persona: Authorize<"persona"> = async (auth) => ({
  Authorization: `Bearer ${auth.apiKey}`,
});

/**
 * Sumsub request signing: HMAC-SHA256(secretKey, ts + METHOD + path?query + raw body), hex.
 * `pathname + search` is exactly the request target fetch puts on the wire, which is what
 * Sumsub verifies against.
 */
const sumsub: Authorize<"sumsub"> = async (auth, call) => {
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
};

/**
 * Kalshi API-key request signing:
 * pre_sign = timestamp_ms + HTTP_METHOD + REQUEST_PATH (no host, no query)
 * signature = base64(RSA-PSS-SHA256(pre_sign, private_key, salt_length = DIGEST_LENGTH))
 */
const kalshi: Authorize<"kalshi"> = async (auth, call) => {
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
};

/**
 * Mock vendor for load tests: does comparable CPU work to a real adapter
 * (sha256 of the body, HS256 JWT keyed by sha256(apiKey)) and is answered locally in proxy.ts.
 */
const mock: Authorize<"mock"> = async (auth, call) => {
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
};

const vendors: { [A in Api]: Authorize<A> } = { iron, moonpay, persona, sumsub, kalshi, mock };

export function authorize(armed: Pick<ArmRequest, "api" | "auth">, call: UpstreamCall) {
  // TS cannot correlate `api` with `auth` across the union; ArmRequestSchema guarantees they match.
  return (vendors[armed.api] as Authorize<Api>)(armed.auth, call);
}
