import { defaultProvider } from "@aws-sdk/credential-provider-node";
import {
	type Binary,
	ClientEncryption,
	type Db,
	MongoClient,
	type UUID,
} from "mongodb";
import {
	AWS_REGION,
	DB_NAME,
	FACE_SIGN_ENCRYPTION_COLLECTION,
	FLE_KEY_ALIAS,
	FLE_KMS_KEY_ID,
	MONGO_URI,
} from "../env.ts";

let db: Db | null = null;
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

export async function storeSession(
	sessionId: string,
	encryptionPrivateKey: Uint8Array,
) {
	const { db, encrypt } = await connectDB();

	await db.collection(FACE_SIGN_ENCRYPTION_COLLECTION).insertOne({
		sessionId,
		encryptionPrivateKey: await encrypt(
			Buffer.from(encryptionPrivateKey).toString("base64"),
		),
	});
}

export async function getSession(sessionId: string) {
	const { db, decrypt } = await connectDB();

	const session = await db
		.collection(FACE_SIGN_ENCRYPTION_COLLECTION)
		.findOne({ sessionId });

	if (!session) {
		return null;
	}

	// TODO: TTL!

	return {
		...session,
		encryptionPrivateKey: Buffer.from(
			await decrypt(session.encryptionPrivateKey),
			"base64",
		),
	};
}
