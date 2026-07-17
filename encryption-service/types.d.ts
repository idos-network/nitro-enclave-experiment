declare module 'libsodium-wrappers' {
  export function ready(): Promise<void>;
  export function crypto_kx_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  export function to_string(buffer: Uint8Array): string;
  export function to_base64(buffer: Uint8Array): string;
  export function randombytes_buf(length: number): Uint8Array;
}