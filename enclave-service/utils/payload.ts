import nacl from "tweetnacl";

export function splitPayload(payloadBase64Url: string, nonceBase64Url?: string): [string, string] {
  if (nonceBase64Url) {
    return [payloadBase64Url, nonceBase64Url];
  }

  const payload = Buffer.from(payloadBase64Url, "base64url");
  const nonce = payload.subarray(0, nacl.box.nonceLength);
  const encrypted = payload.subarray(nacl.box.nonceLength);

  return [Buffer.from(nonce).toString("base64url"), Buffer.from(encrypted).toString("base64url")];
}
