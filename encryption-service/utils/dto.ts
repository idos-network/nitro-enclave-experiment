import { z } from "zod";

export const CommonRequestSchema = z.object({
	session: z.object({
		id: z.uuid(), // UUID v4
		encryptedKey: z.string(), // base64 encoded string of encrypted private key
		nonce: z.string(), // base64 encoded string
	}),
	audience: z.object({
		root: z.string(), // audience root
		identifier: z.string(), // audience identifier
	}),
});

export type CommonRequest = z.infer<typeof CommonRequestSchema>;

export const DataRequestSchema = CommonRequestSchema.extend({
	arguments: z.object({
		payload: z.string(), // base64 encoded string (encrypted for decryption and vice-versa)
		nonce: z.string().optional(), // base64 encoded string (nonce for decryption)
		publicKey: z.string(), // base64 public key (encryptor for decryption, decryptor for encryption)
	}),
});

export type DataRequest = z.infer<typeof DataRequestSchema>;

export const CreateSessionRequestSchema = z.object({
	sessionClientPublicKey: z.string(), // base64 public key
	allowedAudienceRoots: z.array(z.string()), // array of allowed audience roots
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
