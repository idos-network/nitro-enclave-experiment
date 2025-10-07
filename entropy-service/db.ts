import { ClientEncryption, MongoClient, type Db, type ObjectId } from "mongodb";
import { MONGO_URI, DB_COLLECTION_NAME, FLE_KMS_KEY_ID, FLE_KEY_ALIAS } from "./env.ts";
import { DB_NAME } from "../facesign-service/env.js";
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

let db: Db;
let dataKeyId: ObjectId | null = null;

// FLE configuration
const keyVaultNamespace = "encryption.__keyVault";

const kmsProviders = {
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
};

const masterKey = {
  key: FLE_KMS_KEY_ID,
  region: process.env.AWS_REGION as string,
};

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

const clientEncryption = new ClientEncryption(client, {
  keyVaultNamespace,
  kmsProviders,
});

/**
 * Find or create the data encryption key
 */
async function ensureKey() {
  await client.connect();

  const keyVaultCollection = client.db("encryption").collection("__keyVault");
  const existingKey = await keyVaultCollection.findOne({
    keyAltNames: FLE_KEY_ALIAS,
  });

  if (existingKey) {
    return existingKey._id;
  }

  const newKeyId = await clientEncryption.createDataKey("aws", {
    masterKey,
    keyAltNames: [FLE_KEY_ALIAS],
  });

  return newKeyId;
}


export async function connectDB() {
  if (db && dataKeyId) {
    return db;
  }

  dataKeyId = await ensureKey();

  const schemaMap = {
    [`${DB_NAME}.${DB_COLLECTION_NAME}`]: {
      "bsonType": "object",
      "properties": {
        "entropy": {
          "encrypt": {
            "bsonType": "string",
            "algorithm": "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
            "keyId": [dataKeyId]
          }
        },
      }
    }
  };

  // Auto encryption options
  const autoEncryption = {
    keyVaultNamespace,
    kmsProviders,
    schemaMap
  };

  const encryptedClient = new MongoClient(MONGO_URI, {
    autoEncryption,
    maxPoolSize: 10,
    wtimeoutMS: 2500,
  });

  return db = encryptedClient.db(DB_NAME);
}

export async function fetchOrCreateEntropy(faceSignUserId: string) {
  const database = await connectDB();

  const record = await database.collection(DB_COLLECTION_NAME).findOneAndUpdate(
    { faceSignUserId },
    { $setOnInsert: { entropy: bip39.generateMnemonic(wordlist, 256) } },
    { upsert: true, returnDocument: "after" },
  );

  if (!record || !record.value) {
    throw new Error("Failed to fetch or create entropy");
  }

  return record.value.entropy as string;
}
