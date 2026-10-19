import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { type Db, type Document, MongoServerError, type WithId } from "mongodb";
import {
  AWS_REGION,
  DB_NAME,
  FACE_SIGN_ENTROPY_COLLECTION,
  FLE_KEY_ALIAS,
  FLE_KMS_KEY_ID,
  MONGO_URI,
  USED_TOKENS_COLLECTION,
} from "../env.ts";
import { createEncryptedClient } from "../shared/node/db.ts";

let db: Db | null = null;

const { client, codec } = createEncryptedClient(MONGO_URI, {
  keyDb: "encryption",
  keyAlias: FLE_KEY_ALIAS,
  masterKey: { key: FLE_KMS_KEY_ID, region: AWS_REGION },
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

  return { db, ...(await codec()) };
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
