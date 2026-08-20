import nacl from "tweetnacl";

export function splitPayload(payloadBase64Url: string, nonceBase64Url?: string): [string, string] {
  if (nonceBase64Url) {
    return [payloadBase64Url, nonceBase64Url];
  }

  const payload = Buffer.from(payloadBase64Url, "base64url");
  if (payload.length < nacl.box.nonceLength) {
    throw new Error(
      `Payload too short: expected at least ${nacl.box.nonceLength} bytes for nonce, got ${payload.length}`,
    );
  }

  const nonce = payload.subarray(0, nacl.box.nonceLength);
  const encrypted = payload.subarray(nacl.box.nonceLength);

  return [Buffer.from(encrypted).toString("base64url"), Buffer.from(nonce).toString("base64url")];
}
