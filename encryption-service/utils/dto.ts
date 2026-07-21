import { z } from "zod";

export const RequestSchema = z.object({
	wrappedEncryptionKey: z.object({
		sessionId: z.uuid(), // UUID v4
		encryptedKey: z.string(), // base64 encoded string
		nonce: z.string(), // base64 encoded string
	}),
	data: z.string(), // base64 encoded string (encrypted for decryption and vice-versa)
	publicKey: z.string(), // base64 public key (encryptor for decryption, decryptor for encryption)
});

export type Request = z.infer<typeof RequestSchema>;

export const CreateSessionRequestSchema = z.object({
	publicKey: z.string(), // base64 public key
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
