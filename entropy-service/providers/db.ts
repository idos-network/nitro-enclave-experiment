import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { createFleCrypto, KEY_VAULT_COLLECTION } from "@idos/tee-common/fle-crypto.ts";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  Binary,
  type Db,
  type Document,
  MongoClient,
  MongoServerError,
  type WithId,
} from "mongodb";
import {
  AWS_REGION,
  DB_NAME,
  FACE_SIGN_ENTROPY_COLLECTION,
  FLE_KEY_ALIAS,
  FLE_KMS_KEY_ID,
  MONGO_URI,
  USED_TOKENS_COLLECTION,
} from "../env.ts";

let db: Db | null = null;

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 40,
  wtimeoutMS: 2500,
});

const kms = new KMSClient({ region: AWS_REGION });

// Data keys are wrapped by KMS (the `aws` provider) with the host role
const fle = createFleCrypto({
  keyVault: client.db("encryption").collection(KEY_VAULT_COLLECTION),
  Binary,
  keyAlias: FLE_KEY_ALIAS,
  kms: {
    masterKey: { key: FLE_KMS_KEY_ID, region: AWS_REGION },
    encrypt: async (dataKey) => {
      const { CiphertextBlob } = await kms.send(
        new EncryptCommand({ KeyId: FLE_KMS_KEY_ID, Plaintext: dataKey }),
      );
      if (!CiphertextBlob) {
        throw new Error("KMS returned no CiphertextBlob");
      }
      return CiphertextBlob;
    },
    decrypt: async (keyMaterial) => {
      const { Plaintext } = await kms.send(new DecryptCommand({ CiphertextBlob: keyMaterial }));
      if (!Plaintext) {
        throw new Error("KMS returned no Plaintext");
      }
      return Plaintext;
    },
  },
});

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(DB_NAME);

    // Create a unique index on faceSignUserId
    await db
      .collection(FACE_SIGN_ENTROPY_COLLECTION)
      .createIndex({ faceSignUserId: 1 }, { unique: true });
  }

  return {
    db,
    ...(await fle()),
  };
}

let usedTokensIndexes: Promise<unknown> | null = null;

/**
 * Marks token `jti` as used. Returns false when it was already used (replay).
 * TTL only needs to outlive the token max age (60s), the unique index does the work.
 */
export async function consumeTokenId(jti: string): Promise<boolean> {
  await client.connect();
  const collection = client
    .db(DB_NAME)
    .collection<{ _id: string; createdAt: Date }>(USED_TOKENS_COLLECTION);

  // Cleared on failure so a transient error isn't cached forever.
  usedTokensIndexes ??= collection
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: 5 * 60 })
    .catch((error) => {
      usedTokensIndexes = null;
      throw error;
    });
  await usedTokensIndexes;

  try {
    await collection.insertOne({ _id: jti, createdAt: new Date() });
    return true;
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) return false;
    throw err;
  }
}

/**
 * Undoes consumeTokenId when the request failed after reserving the token,
 * so the client can retry with the same token while it is still valid.
 */
export async function releaseTokenId(jti: string): Promise<void> {
  await client
    .db(DB_NAME)
    .collection<{ _id: string; createdAt: Date }>(USED_TOKENS_COLLECTION)
    .deleteOne({ _id: jti });
}

export async function fetchOrCreateFaceSignEntropy(
  faceSignUserId: string,
): Promise<{ insert: boolean; entropy: string }> {
  const { db, encrypt, decrypt } = await connectDB();
  const collection = db.collection(FACE_SIGN_ENTROPY_COLLECTION);

  // try to find existing encrypted record
  const existing = await collection.findOne({ faceSignUserId });

  if (existing?.entropy) {
    const decrypted = await decrypt<Buffer>(existing.entropy);
    return { insert: false, entropy: decrypted.toString() };
  }

  // create new entropy and encrypt
  const mnemonic = bip39.generateMnemonic(wordlist, 256);
  const encryptedEntropy = await encrypt(mnemonic);

  // $setOnInsert + upsert leaves exactly one entropy per user, but the caller
  // that loses the race must return the *stored* one, not the mnemonic it just
  // generated and threw away.
  let stored: WithId<Document> | null;

  try {
    stored = await collection.findOneAndUpdate(
      { faceSignUserId },
      { $setOnInsert: { entropy: encryptedEntropy } },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    // A racing insert that landed between our findOne and the upsert surfaces
    // against the unique index as E11000; the winner's document is now there.
    if (!(error instanceof MongoServerError) || error.code !== 11000) {
      throw error;
    }

    stored = await collection.findOne({ faceSignUserId });
  }

  if (!stored?.entropy) {
    throw new Error("Entropy upsert stored no document");
  }

  const entropy = (await decrypt<Buffer>(stored.entropy)).toString();

  // We created it only if what is stored is the mnemonic we generated.
  return { insert: entropy === mnemonic, entropy };
}
