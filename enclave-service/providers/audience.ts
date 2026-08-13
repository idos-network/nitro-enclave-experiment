import { createRemoteJWKSet, jwtVerify } from "jose";
import { writeLog } from "../utils/logger-context.ts";

const keySetCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAudience(
  allowedAudienceRoots: string[],
  jwtChain: string,
): Promise<Buffer | null> {
  for (const root of allowedAudienceRoots) {
    // This throws an error if the URL is not valid
    const url = jwksUrl(root);

    try {
      const jwks = remoteJwks(url);

      const { payload } = await jwtVerify(jwtChain, jwks, {
        algorithms: ["EdDSA"],
      });

      const { recipientPublicKeyX } = payload;

      if (typeof recipientPublicKeyX === "string") {
        return Buffer.from(recipientPublicKeyX, "base64url");
      }
    } catch (error) {
      writeLog("session_request_invalid_body", { error: String(error), root });
      return null;
    }
  }

  return null;
}

function remoteJwks(url: string) {
  const cached = keySetCache.get(url);

  if (cached) {
    return cached;
  }

  // Under the hood according the doc, this is automatically refreshed every 1 minute
  // so we don't need to refresh it manually
  const jwks = createRemoteJWKSet(new URL(url), {
    timeoutDuration: 3_000,
    cooldownDuration: 60_000,
  });
  keySetCache.set(url, jwks);
  return jwks;
}

function jwksUrl(root: string): string {
  try {
    const normalizedRoot = root.includes("://") ? root : `https://${root}`;
    const url = new URL(normalizedRoot);

    if (url.protocol !== "https:") {
      throw new Error(`Only HTTPS URLs are supported for root: ${root}`);
    }

    url.pathname = `${url.pathname.replace(/\/+$/, "")}/.well-known/jwks.json`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (error) {
    writeLog("audience_jwks_url_not_found", {
      root,
      error: String(error),
    });

    throw new Error(`Error getting JWKS URL for root: ${root}`);
  }
}
