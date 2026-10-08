import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, errors, jwtVerify } from "jose";
import { writeLog } from "../utils/logger-context.ts";

const SUPPORTED_ALGORITHMS = ["EdDSA"];

const keySetCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Audience verification failure. `message` is safe to return to the client,
 * `status` is 400 for a bad JWT and 502 when we couldn't reach the audience JWKS.
 */
export class AudienceError extends Error {
  status: 400 | 502;

  constructor(message: string, status: 400 | 502 = 400) {
    super(message);
    this.name = "AudienceError";
    this.status = status;
  }
}

/**
 * Verify the audience JWT against the JWKS of each allowed root and return
 * the recipient X25519 public key. Throws AudienceError on any failure.
 */
export async function verifyAudience(
  allowedAudienceRoots: string[],
  jwtChain: string,
): Promise<Buffer> {
  assertSupportedAlgorithm(jwtChain);

  const unreachableRoots: string[] = [];

  for (const root of allowedAudienceRoots) {
    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];

    try {
      ({ payload } = await jwtVerify(jwtChain, remoteJwks(jwksUrl(root)), {
        algorithms: SUPPORTED_ALGORITHMS,
      }));
    } catch (error) {
      if (error instanceof AudienceError) throw error;

      // Not signed by this root, try the next one.
      if (
        error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JWSSignatureVerificationFailed
      ) {
        continue;
      }

      // Signature is fine (or the token is broken), but claims are not — no other root will help.
      if (error instanceof errors.JWTExpired) {
        throw new AudienceError("Audience JWT has expired.");
      }
      if (error instanceof errors.JWTClaimValidationFailed) {
        throw new AudienceError(`Audience JWT claim "${error.claim}" is invalid: ${error.reason}.`);
      }
      if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) {
        throw new AudienceError("Audience jwtChain is not a valid compact JWS/JWT.");
      }

      // Anything else (timeout, network, invalid JWKS document) is an infra problem on the root side.
      writeLog("audience_jwks_unavailable", { root, error: String(error) });
      unreachableRoots.push(root);
      continue;
    }

    const { recipientPublicKeyX } = payload;
    if (typeof recipientPublicKeyX !== "string") {
      throw new AudienceError('Audience JWT is missing the "recipientPublicKeyX" claim.');
    }

    return Buffer.from(recipientPublicKeyX, "base64url");
  }

  if (unreachableRoots.length > 0) {
    throw new AudienceError(
      `Could not fetch JWKS for audience root(s): ${unreachableRoots.join(", ")}.`,
      502,
    );
  }

  throw new AudienceError(
    `Audience JWT is not signed by any allowed audience root (${allowedAudienceRoots.join(", ")}).`,
  );
}

/**
 * TEMPORARY (staging only): read the recipient X25519 public key from the audience JWT
 * WITHOUT verifying signature, roots or claims. Throws AudienceError on a malformed JWT.
 */
export function extractAudience(jwtChain: string): Buffer {
  let payload: ReturnType<typeof decodeJwt>;
  try {
    payload = decodeJwt(jwtChain);
  } catch {
    throw new AudienceError("Audience jwtChain is not a valid compact JWS/JWT.");
  }

  const { recipientPublicKeyX } = payload;
  if (typeof recipientPublicKeyX !== "string") {
    throw new AudienceError('Audience JWT is missing the "recipientPublicKeyX" claim.');
  }

  return Buffer.from(recipientPublicKeyX, "base64url");
}

// Checked upfront: jose's "alg not allowed" is easy to misread as a signature problem.
function assertSupportedAlgorithm(jwtChain: string) {
  let alg: unknown;
  try {
    ({ alg } = decodeProtectedHeader(jwtChain));
  } catch {
    throw new AudienceError("Audience jwtChain is not a valid compact JWS/JWT.");
  }

  if (typeof alg !== "string" || !SUPPORTED_ALGORITHMS.includes(alg)) {
    throw new AudienceError(
      `Unsupported audience JWT algorithm "${String(alg)}". Supported: ${SUPPORTED_ALGORITHMS.join(", ")} (Ed25519).`,
    );
  }
}

// Roots come from a fixed allowlist (CreateSessionRequestSchema), so this cache stays bounded
// and we only ever fetch from known hosts (no SSRF surface).
function remoteJwks(url: string) {
  const cached = keySetCache.get(url);

  if (cached) {
    return cached;
  }

  // jose caches the JWKS for cacheMaxAge and fetches it again on an unknown kid
  // (at most once per cooldownDuration).
  const jwks = createRemoteJWKSet(new URL(url), {
    timeoutDuration: 3_000,
    cooldownDuration: 60_000,
    cacheMaxAge: 60_000,
  });
  keySetCache.set(url, jwks);
  return jwks;
}

function jwksUrl(root: string): string {
  const normalizedRoot = root.includes("://") ? root : `https://${root}`;
  const url = new URL(normalizedRoot);

  if (url.protocol !== "https:") {
    throw new AudienceError(`Only HTTPS audience roots are supported: ${root}`);
  }

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/.well-known/jwks.json`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
