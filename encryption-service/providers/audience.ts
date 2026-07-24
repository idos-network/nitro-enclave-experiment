import {
	createRemoteJWKSet,
	jwtVerify,
} from "jose";
import type { DataRequest } from "../utils/dto.ts";

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAudience(
	allowedAudienceRoots: string[],
	request: DataRequest["audience"],
): Promise<Buffer | null> {
	for (const root of allowedAudienceRoots) {
		const url = jwksUrl(root);
		if (!url) {
			continue;
		}

		try {
			const jwks = remoteJwks(url);

			const { payload } = await jwtVerify(request.jwtChain, jwks, {
				algorithms: ["EdDSA"],
			});

			const { recipientPublicKeyX } = payload;

			if (typeof recipientPublicKeyX === "string") {
				return Buffer.from(recipientPublicKeyX, "base64url");
			}
		} catch {
			continue;
		}
	}

	return null;
}

function remoteJwks(url: string) {
	const cached = jwksByUrl.get(url);
	if (cached) {
		return cached;
	}

	const jwks = createRemoteJWKSet(new URL(url), { timeoutDuration: 3_000 });
	jwksByUrl.set(url, jwks);
	return jwks;
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
