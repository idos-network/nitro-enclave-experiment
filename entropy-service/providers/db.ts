import { defaultProvider } from "@aws-sdk/credential-provider-node";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
	Binary,
	ClientEncryption,
	type Db,
	MongoClient,
	type UUID,
} from "mongodb";
import {
	AWS_REGION,
	DB_NAME,
	DB_PINOCCHIO_COLLECTION_NAME,
	FLE_KEY_ALIAS,
	FLE_KMS_KEY_ID,
	MONGO_URI,
} from "../env.ts";

let db: Db;
let cacheClientEncryption: ClientEncryption | null = null;

// FLE configuration
const KEY_DB = "encryption";
const KEY_COLLECTION = "__keyVault";
const keyVaultNamespace = `${KEY_DB}.${KEY_COLLECTION}`;

const client = new MongoClient(MONGO_URI, {
	maxPoolSize: 10,
	wtimeoutMS: 2500,
});

async function ensureKmsProviders() {
	const credentialsProvider = defaultProvider();
	const credentials = await credentialsProvider();

	return {
		aws: {
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
			// For some reason the types say sessionToken is string, but it can be undefined
			// and it's trying to set never to string... it's weird
			// biome-ignore lint/suspicious/noExplicitAny: invalid types
			sessionToken: credentials.sessionToken as any,
		},
	};
}

async function getClientEncryption() {
	if (cacheClientEncryption) {
		return cacheClientEncryption;
	}

	const kmsProviders = await ensureKmsProviders();

	cacheClientEncryption = new ClientEncryption(client, {
		keyVaultNamespace,
		kmsProviders,
	});

	return cacheClientEncryption;
}

/**
 * Find or create the data encryption key
 */
async function ensureKey(): Promise<UUID> {
	await client.connect();

	// Check if collection exists
	const collections = await client
		.db(KEY_DB)
		.listCollections({}, { nameOnly: true })
		.toArray();

	const collectionExists = collections.some((c) => c.name === KEY_COLLECTION);

	if (!collectionExists) {
		// Initialize key storage
		await client.db(KEY_DB).createCollection(KEY_COLLECTION);
		await client
			.db(KEY_DB)
			.collection(KEY_COLLECTION)
			.createIndex(
				{ keyAltNames: 1 },
				{
					unique: true,
					partialFilterExpression: { keyAltNames: { $exists: true } },
				},
			);
	}

	const clientEncryption = await getClientEncryption();
	const existingKey = await clientEncryption.getKeyByAltName(FLE_KEY_ALIAS);

	if (existingKey) {
		return existingKey._id;
	}

	return await clientEncryption.createDataKey("aws", {
		masterKey: {
			key: FLE_KMS_KEY_ID,
			region: AWS_REGION,
		},
		keyAltNames: [FLE_KEY_ALIAS],
	});
}

export async function connectDB() {
	if (!db) {
		await client.connect();
		db = client.db(DB_NAME);
	}

	const dataKeyId = await ensureKey();
	const clientEncryption = await getClientEncryption();

	return {
		db,
		encrypt: async (value: string) => {
			return clientEncryption.encrypt(value, {
				keyId: dataKeyId,
				algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
			});
		},
		decrypt: async (value: Binary) => {
			return clientEncryption.decrypt(value);
		},
	};
}

export async function fetchOrCreatePINOCCHIOEntropy(
	faceSignUserId: string,
): Promise<{ insert: boolean; entropy: string }> {
	const { db, encrypt, decrypt } = await connectDB();

	// try to find existing encrypted record
	const existing = await db
		.collection(DB_PINOCCHIO_COLLECTION_NAME)
		.findOne({ faceSignUserId });

	if (existing?.entropy) {
		// biome-ignore lint/suspicious/noExplicitAny: We don't know the type yet
		let payloadForDecrypt: any = existing.entropy;

		if (Buffer.isBuffer(payloadForDecrypt)) {
			payloadForDecrypt = new Binary(payloadForDecrypt, 6);
		} else if (typeof payloadForDecrypt === "string") {
			const buf = Buffer.from(payloadForDecrypt, "base64");
			payloadForDecrypt = new Binary(buf, 6);
		} else if (payloadForDecrypt?.$binary?.base64) {
			const buf = Buffer.from(payloadForDecrypt.$binary.base64, "base64");
			payloadForDecrypt = new Binary(
				buf,
				parseInt(payloadForDecrypt.$binary.subType, 16),
			);
		}

		if (!payloadForDecrypt) {
			throw new Error("Invalid entropy format");
		}

		const decrypted = await decrypt(payloadForDecrypt);
		return { insert: false, entropy: decrypted.toString() };
	}

	// create new entropy and encrypt
	const mnemonic = bip39.generateMnemonic(wordlist, 256);
	const encryptedEntropy = await encrypt(mnemonic);

	await db
		.collection(DB_PINOCCHIO_COLLECTION_NAME)
		.findOneAndUpdate(
			{ faceSignUserId },
			{ $setOnInsert: { entropy: encryptedEntropy } },
			{ upsert: true },
		);

	return { insert: true, entropy: mnemonic };
}
