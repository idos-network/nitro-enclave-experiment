import type { BoxKeyPair } from "tweetnacl";
import nacl from "tweetnacl";

export function encrypt(
	keyPair: BoxKeyPair,
	recipientEncryptionPublicKey: string,
	message: string,
): string {
	const nonce = nacl.randomBytes(nacl.box.nonceLength);

	const encrypted = nacl.box(
		Buffer.from(message, "base64"),
		nonce,
		Buffer.from(recipientEncryptionPublicKey, "base64"),
		keyPair.secretKey,
	);

	if (encrypted === null)
		throw Error(
			`Couldn't encrypt the provided message. ${JSON.stringify(
				{
					message,
					nonce: Buffer.from(nonce).toString("base64"),
					recipientEncryptionPublicKey,
				},
				null,
				2,
			)}`,
		);

	const fullMessage = new Uint8Array(nonce.length + encrypted.length);
	fullMessage.set(nonce, 0);
	fullMessage.set(encrypted, nonce.length);

	return Buffer.from(fullMessage).toString("base64");
}

export function decrypt(
	keyPair: BoxKeyPair,
	senderEncryptionPublicKey: string,
	message: string,
): string {
	const fullMessage = Buffer.from(message, "base64");
	const nonce = fullMessage.subarray(0, nacl.box.nonceLength);
	const encrypted = fullMessage.subarray(nacl.box.nonceLength);

	const decrypted = nacl.box.open(
		encrypted,
		nonce,
		Buffer.from(senderEncryptionPublicKey, "base64"),
		keyPair.secretKey,
	);

	if (decrypted === null) {
		throw Error(
			`Couldn't decrypt the provided message. ${JSON.stringify(
				{
					message,
					nonce: Buffer.from(nonce).toString("base64"),
					senderEncryptionPublicKey,
				},
				null,
				2,
			)}`,
		);
	}

	return Buffer.from(decrypted).toString("base64");
}
