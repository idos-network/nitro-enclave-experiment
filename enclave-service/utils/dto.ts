import { z } from "zod";

export const CommonRequestSchema = z.object({
  session: z.object({
    id: z.uuid(), // UUID v4
    encryptedKey: z
      .string()
      // Note: The length of base64url-encoding a 32-byte NaCl secret key is 43 or 44 characters (not 64), but
      // we are encoding a 48-byte NaCl "box", which would be base64url-encoded as 64 chars
      // If this is to strictly match a 48-byte box, keep as 64 chars; for a 32-byte key, use 43 or 44 chars
      .regex(/^[A-Za-z0-9_-]{64}$/), // base64url-encoded 48-byte NaCl box (64 chars)
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/), // base64url-encoded 24-byte NaCl nonce (32 chars)
  }),
  audience: z.object({
    recipient: z.object({
      kty: z.literal("OKP"),
      crv: z.literal("X25519"),
      x: z.string().regex(/^[A-Za-z0-9_-]+$/), // recipient public key x coordinate of elliptic curve (base64url-encoded)
      use: z.literal("enc"),
      kid: z.string(), // key id
    }),
    jwtChain: z.string(), // Compact JWS over { recipientPublicKeyX }
  }),
});

export type CommonRequest = z.infer<typeof CommonRequestSchema>;

export const EncryptRequestSchema = z.object({
  arguments: z.object({
    payload: z.string().regex(/^[A-Za-z0-9_-]+$/), // base64url encoded string (encrypted for decryption and vice-versa)
    nonce: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32}$/)
      .optional(), // base64url encoded string (nonce for decryption)
    publicKey: z.string().regex(/^[A-Za-z0-9_-]{43,44}$/), // base64url-encoded 32-byte public key (encryptor for decryption, decryptor for encryption)
  }),
});

export type EncryptRequest = z.infer<typeof EncryptRequestSchema>;

export const DecryptRequestSchema = EncryptRequestSchema.merge(CommonRequestSchema);
export type DecryptRequest = z.infer<typeof DecryptRequestSchema>;

export const CreateSessionRequestSchema = z.object({
  sessionClientPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43,44}$/), // base64url-encoded 32-byte NaCl box public key
  allowedAudienceRoots: z.array(
    z.enum(["relay.idos.network", "relay.staging.idos.network", "relay.playground.idos.network"]),
  ), // array of allowed audience roots
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
