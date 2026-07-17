import {
	GetPublicKeyCommand,
	KMSClient,
	SignCommand,
} from "@aws-sdk/client-kms";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { AWS_REGION, SIGNING_KEY_KMS_KEY_ID } from "../env.ts";

export async function getPublicKey() {
	const credentialsProvider = defaultProvider();
	const credentials = await credentialsProvider();

	const kms = new KMSClient({
		region: AWS_REGION,
		credentials: {
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
			// For some reason the types say sessionToken is string, but it can be undefined
			// and it's trying to set never to string... it's weird
			// biome-ignore lint/suspicious/noExplicitAny: invalid types
			sessionToken: credentials.sessionToken as any,
		},
	});

	const response = await kms.send(
		new GetPublicKeyCommand({
			KeyId: SIGNING_KEY_KMS_KEY_ID,
		}),
	);

	if (!response.PublicKey) {
		throw new Error("No public key returned");
	}

	return Buffer.from(response.PublicKey).toString("hex");
}

export async function sign(payload: Uint8Array<ArrayBufferLike>) {
	const credentialsProvider = defaultProvider();
	const credentials = await credentialsProvider();

	const kms = new KMSClient({
		region: AWS_REGION,
		credentials: {
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
			// For some reason the types say sessionToken is string, but it can be undefined
			// and it's trying to set never to string... it's weird
			// biome-ignore lint/suspicious/noExplicitAny: invalid types
			sessionToken: credentials.sessionToken as any,
		},
	});

	const response = await kms.send(
		new SignCommand({
			KeyId: SIGNING_KEY_KMS_KEY_ID,
			Message: payload,
			SigningAlgorithm: "ED25519_SHA_512",
			MessageType: "RAW",
		}),
	);

	if (!response.Signature) {
		throw new Error("No signature returned");
	}

	return Buffer.from(response.Signature).toString("base64");
}
