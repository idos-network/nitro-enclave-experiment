import { z } from "zod";

export const RequestSchema = z.object({
	sessionId: z.uuid(), // UUID v4
  wrappedUserKey: z.object({
    encryptedKey: z.string(), // base64 encoded string
    nonce: z.string(), // base64 nonce
    publicKey: z.string(), // base64 client public key
  }),
	data: z.string(), // base64 encoded string (encrypted for decryption and vice-versa)
  publicKey: z.string(), // base64 public key (encryptor for decryption, decryptor for encryption)
});

export type Request = z.infer<typeof RequestSchema>;
