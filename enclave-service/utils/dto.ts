import { z } from "zod";

export const CommonRequestSchema = z.object({
  session: z.object({
    id: z.uuid(), // UUID v4
    // 48-byte NaCl box (32-byte secret key + 16-byte MAC) => 64 base64url chars
    encryptedKey: z.base64url().length(64),
    nonce: z.base64url().length(32), // base64url-encoded 24-byte NaCl nonce (32 chars)
  }),
  audience: z.object({
    recipient: z.object({
      kty: z.literal("OKP"),
      crv: z.literal("X25519"),
      x: z.base64url().max(256), // recipient public key x coordinate of elliptic curve (base64url-encoded)
      use: z.literal("enc"),
      kid: z.string(), // key id
    }),
    jwtChain: z.string(), // Compact JWS over { recipientPublicKeyX }
  }),
});

export type CommonRequest = z.infer<typeof CommonRequestSchema>;

export const EncryptRequestSchema = z.object({
  arguments: z.object({
    payload: z.base64url(), // base64url encoded string (encrypted for decryption and vice-versa)
    nonce: z.base64url().length(32).optional(), // base64url encoded string (nonce for decryption)
    publicKey: z.base64url().min(43).max(44), // base64url-encoded 32-byte public key (encryptor for decryption, decryptor for encryption)
  }),
});

export type EncryptRequest = z.infer<typeof EncryptRequestSchema>;

export const DecryptRequestSchema = EncryptRequestSchema.extend(CommonRequestSchema.shape);
export type DecryptRequest = z.infer<typeof DecryptRequestSchema>;

export const CreateSessionRequestSchema = z.object({
  sessionClientPublicKey: z.base64url().min(43).max(44), // base64url-encoded 32-byte NaCl box public key
  allowedAudienceRoots: z.array(
    z.enum(["relay.idos.network", "relay.staging.idos.network", "relay.playground.idos.network"]),
  ), // array of allowed audience roots
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
