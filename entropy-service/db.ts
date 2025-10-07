import { ClientEncryption, MongoClient, type Db } from "mongodb";
import { MONGO_URI, DB_COLLECTION_NAME, FLE_KMS_KEY_ID } from "./env.ts";
import { DB_NAME } from "../facesign-service/env.js";

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 10,
  wtimeoutMS: 2500,
});

let db: Db;

async function ensureKey() {

}

export async function connectDB() {
  if (!db) {
    // TODO: Skip if already exists
    const kmsProviders = {
      aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
      }
    };

    // KMS key ARN, region
    const masterKey = {
      key: FLE_KMS_KEY_ID,
      region: process.env.AWS_REGION as string,
    };

    await client.connect();
    db = client.db(DB_NAME);

    // keyVault namespace: db.collection
    const keyVaultNamespace = "encryption.__keyVault";

    const keyVaultClient = client.db("encryption").collection("__keyVault");
    const encryption = new ClientEncryption(client, {
      keyVaultNamespace,
      kmsProviders,
    });

    // Vytvoří data key
    const dataKeyId = await encryption.createDataKey('aws', {
      masterKey,
      keyAltNames: ['entropy-encryption-key'],
    });

    console.log("DataKeyId (base64):", dataKeyId.toString('base64'));
    console.log("Inserted into:", keyVaultNamespace);

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
      keyVaultNamespace: "encryption.__keyVault",
      kmsProviders,
      schemaMap
    };

  }

  return db;
}

export async function insertMember(groupName, faceSignUserId) {
  const database = await connectDB();
  try {
    const result = await database.collection(DB_COLLECTION_NAME).insertOne({
      groupName,
      faceSignUserId,
      createdAt: new Date()
    });

    return result;
  } catch (err) {
    if (err.code === 11000) {
      console.log("faceSignId already exists:", faceSignUserId);
      return null;
    }

    throw err;
  }
}
