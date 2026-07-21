import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../providers/encryption.ts";
import { b64 } from "./helpers.ts";

describe("encrypt/decrypt", () => {
	it("round-trips a message between two key pairs", () => {
		const sender = nacl.box.keyPair();
		const recipient = nacl.box.keyPair();
		const plaintext = b64(Buffer.from("hello encryption service"));

		const ciphertext = encrypt(sender, b64(recipient.publicKey), plaintext);
		const recovered = decrypt(recipient, b64(sender.publicKey), ciphertext);

		expect(recovered).toBe(plaintext);
		expect(Buffer.from(recovered, "base64").toString()).toBe(
			"hello encryption service",
		);
	});

	it("fails to decrypt with the wrong recipient key", () => {
		const sender = nacl.box.keyPair();
		const recipient = nacl.box.keyPair();
		const impostor = nacl.box.keyPair();
		const plaintext = b64(Buffer.from("secret"));

		const ciphertext = encrypt(sender, b64(recipient.publicKey), plaintext);

		expect(() => decrypt(impostor, b64(sender.publicKey), ciphertext)).toThrow(
			/Couldn't decrypt/,
		);
	});
});
