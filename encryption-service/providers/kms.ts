import { createPublicKey } from "node:crypto";
import {
	GetPublicKeyCommand,
	KMSClient,
	SignCommand,
} from "@aws-sdk/client-kms";
import { AWS_REGION, SIGNING_KEY_KMS_KEY_ID } from "../env.ts";

export async function getPublicKeyJWK() {
	const kms = new KMSClient({
		region: AWS_REGION,
	});

	const response = await kms.send(
		new GetPublicKeyCommand({
			KeyId: SIGNING_KEY_KMS_KEY_ID,
		}),
	);

	if (!response.PublicKey) {
		throw new Error("No public key returned");
	}

	// KMS returns SubjectPublicKeyInfo DER; Node exports that as JWK.
	const jwk = createPublicKey({
		key: Buffer.from(response.PublicKey),
		format: "der",
		type: "spki",
	}).export({ format: "jwk" });

	return {
		...jwk,
		kid: SIGNING_KEY_KMS_KEY_ID,
		use: "sig",
		alg: "RS256",
	};
}

export async function sign(payload: Uint8Array<ArrayBufferLike>) {
	const kms = new KMSClient({
		region: AWS_REGION,
	});

	const response = await kms.send(
		new SignCommand({
			KeyId: SIGNING_KEY_KMS_KEY_ID,
			Message: payload,
			SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
			MessageType: "RAW",
		}),
	);

	if (!response.Signature) {
		throw new Error("No signature returned");
	}

	return Buffer.from(response.Signature);
}
