import {
  constants,
  createCipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { unwrapEnvelope } from "@idos/nitro-nsm/kms-decrypt.ts";
import { describe, expect, it } from "vitest";

// Minimal BER writer for a stand-in of KMS's CiphertextForRecipient
function der(tag: number, ...parts: Uint8Array[]) {
  const body = Buffer.concat(parts);
  const length =
    body.length < 0x80
      ? [body.length]
      : body.length < 0x100
        ? [0x81, body.length]
        : [0x82, body.length >> 8, body.length & 0xff];

  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}
const indefinite = (tag: number, ...parts: Uint8Array[]) =>
  Buffer.concat([Buffer.from([tag, 0x80]), ...parts, Buffer.from([0, 0])]);
const oid = (hex: string) => der(0x06, Buffer.from(hex, "hex"));
const sequence = (...parts: Uint8Array[]) => der(0x30, ...parts);

const ENVELOPED_DATA = "2a864886f70d010703";
const DATA = "2a864886f70d010701";
const RSAES_OAEP = "2a864886f70d010107";
const MGF1 = "2a864886f70d010108";
const SHA256 = "608648016503040201";
const AES_256_CBC = "60864801650304012a";

// CMS EnvelopedData the way KMS sends it: one RSA-OAEP-SHA256 recipient, AES-256-CBC content,
// indefinite lengths and the ciphertext split into chunks.
function envelope(plaintext: Buffer, publicKey: Parameters<typeof publicEncrypt>[0]) {
  const key = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const content = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const recipient = sequence(
    der(0x02, Buffer.from([2])),
    der(0x80, randomBytes(20)), // subjectKeyIdentifier
    sequence(
      oid(RSAES_OAEP),
      sequence(
        der(0xa0, sequence(oid(SHA256))),
        der(0xa1, sequence(oid(MGF1), sequence(oid(SHA256)))),
      ),
    ),
    der(0x04, publicEncrypt(publicKey, key)),
  );

  return indefinite(
    0x30,
    oid(ENVELOPED_DATA),
    indefinite(
      0xa0,
      indefinite(
        0x30,
        der(0x02, Buffer.from([2])),
        der(0x31, recipient),
        indefinite(
          0x30,
          oid(DATA),
          sequence(oid(AES_256_CBC), der(0x04, iv)),
          indefinite(0xa0, der(0x04, content.subarray(0, 16)), der(0x04, content.subarray(16))),
        ),
      ),
    ),
  );
}

describe("unwrapEnvelope", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const oaep = { key: publicKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING };

  it("opens a KMS-shaped CMS envelope with the enclave's RSA key", () => {
    const plaintext = randomBytes(96);

    expect(unwrapEnvelope(envelope(plaintext, oaep), privateKey)).toEqual(plaintext);
  });
});
