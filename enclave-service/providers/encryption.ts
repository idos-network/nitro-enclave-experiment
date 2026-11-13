import { traced } from "@idos/tee-common/telemetry.ts";
import nacl from "tweetnacl";
import { box, boxOpen, keyPair } from "./box.ts";

export const encrypt = traced(
  "box.encrypt",
  (
    messageBase64Url: string,
    recipientEncryptionPublicKeyBase64Url: string,
  ): { nonce: string; encrypted: string; publicKey: string } => {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ephemeralKeyPair = keyPair();

    const encrypted = box(
      Buffer.from(messageBase64Url, "base64url"),
      nonce,
      Buffer.from(recipientEncryptionPublicKeyBase64Url, "base64url"),
      ephemeralKeyPair.secretKey,
    );

    if (encrypted === null)
      throw Error(
        `Couldn't encrypt the provided message. ${JSON.stringify(
          {
            nonce: Buffer.from(nonce).toString("base64url"),
            recipient: recipientEncryptionPublicKeyBase64Url,
          },
          null,
          2,
        )}`,
      );

    return {
      nonce: Buffer.from(nonce).toString("base64url"),
      encrypted: Buffer.from(encrypted).toString("base64url"),
      publicKey: Buffer.from(ephemeralKeyPair.publicKey).toString("base64url"),
    };
  },
);

export const decrypt = traced(
  "box.decrypt",
  (
    messageBase64Url: string,
    nonceBase64Url: string,
    senderEncryptionPublicKeyBase64Url: string,
    sessionEncryptionPrivateKey: Uint8Array,
  ): string => {
    const decrypted = boxOpen(
      Buffer.from(messageBase64Url, "base64url"),
      Buffer.from(nonceBase64Url, "base64url"),
      Buffer.from(senderEncryptionPublicKeyBase64Url, "base64url"),
      sessionEncryptionPrivateKey,
    );

    if (decrypted === null) {
      throw Error(
        `Couldn't decrypt the provided message. ${JSON.stringify(
          {
            nonce: nonceBase64Url,
            sender: senderEncryptionPublicKeyBase64Url,
          },
          null,
          2,
        )}`,
      );
    }

    return Buffer.from(decrypted).toString("base64url");
  },
);
