import { createPublicKey, type JsonWebKeyInput, type webcrypto } from "node:crypto";
import jwt from "jsonwebtoken";
import type { DataRequest } from "../utils/dto.ts";

type AudienceJwk = webcrypto.JsonWebKey & {
	kid?: string;
};

export async function verifyAudience(
	allowedAudienceRoots: string[],
	request: DataRequest["audience"],
): Promise<Buffer | null> {
	const claim = readAudienceClaim(request.jwtChain);

	if (!claim) {
		return null;
	}

	const recipientPublicKey = Buffer.from(
		claim.recipientPublicKeyX,
		"base64url",
	);

	for (const root of allowedAudienceRoots) {
		for (const key of await fetchJwksKeys(root)) {
			if (
				(!claim.kid || key.kid === claim.kid) &&
				verifyRsaJwt(request.jwtChain, key)
			) {
				return recipientPublicKey;
			}
		}
	}

	return null;
}

function readAudienceClaim(chain: string) {
	try {
		const decoded = jwt.decode(chain, { complete: true });

		if (!decoded || !isObject(decoded.header) || !isObject(decoded.payload)) {
			return null;
		}

		const { alg, kid } = decoded.header;
		const { recipientPublicKeyX } = decoded.payload;

		if (
			alg !== "RS256" ||
			(kid !== undefined && typeof kid !== "string") ||
			typeof recipientPublicKeyX !== "string"
		) {
			return null;
		}

		return {
			...(kid === undefined ? {} : { kid }),
			recipientPublicKeyX,
		};
	} catch {
		return null;
	}
}

async function fetchJwksKeys(root: string): Promise<AudienceJwk[]> {
	const url = jwksUrl(root);
	if (!url) {
		return [];
	}

	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(3_000),
		});
		if (!response.ok) {
			return [];
		}

		const jwks = (await response.json()) as { keys?: AudienceJwk[] };
		return Array.isArray(jwks.keys) ? jwks.keys : [];
	} catch {
		return [];
	}
}

function jwksUrl(root: string): string | null {
	try {
		const normalizedRoot = root.includes("://") ? root : `https://${root}`;
		const url = new URL(normalizedRoot);
		if (url.protocol !== "https:") {
			return null;
		}

		url.pathname = `${url.pathname.replace(/\/+$/, "")}/.well-known/jwks.json`;
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

function verifyRsaJwt(jwtChain: string, key: AudienceJwk): boolean {
	if (key.kty !== "RSA" || (key.alg !== undefined && key.alg !== "RS256")) {
		return false;
	}

	try {
		const publicKey: JsonWebKeyInput = {
			format: "jwk" as const,
			key: createPublicKey({ key, format: "jwk" }).export({
				format: "jwk" as const,
			}),
		};

		return !!jwt.verify(jwtChain, publicKey, { algorithms: ["RS256"] });
	} catch {
		return false;
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
