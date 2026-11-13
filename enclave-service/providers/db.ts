import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { createFleCrypto, KEY_VAULT_COLLECTION } from "@idos/tee-common/fle-crypto.ts";
import { getLogger } from "@idos/tee-common/logger.ts";
import { Binary, type Db, MongoClient } from "mongodb";
import type { BoxKeyPair } from "tweetnacl";
import {
  DB_ENCLAVE_COLLECTION,
  DB_NAME,
  FLE_KEY_ALIAS,
  FLE_MASTER_KEY,
  MONGO_URI,
  SESSION_TTL_SECONDS,
} from "../env.ts";

let db: Db | null = null;

const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 40,
  wtimeoutMS: 2500,
});

const fle = createFleCrypto({
  keyVault: client.db("enclaveEncryption").collection(KEY_VAULT_COLLECTION),
  Binary,
  keyAlias: FLE_KEY_ALIAS,
  // decrypted with attestation by scripts/run.ash, see localMasterKey in tee-common/fle-crypto.ts
  localMasterKey: Buffer.from(FLE_MASTER_KEY, "base64"),
  // only for the one-off rewrap of a data key still wrapped by KMS, with the host role
  kms: {
    decrypt: async (keyMaterial) => {
      const { Plaintext } = await new KMSClient().send(
        new DecryptCommand({ CiphertextBlob: keyMaterial }),
      );
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
    const sessions = client.db(DB_NAME).collection(DB_ENCLAVE_COLLECTION);
    await Promise.all([
      sessions.createIndex({ sessionId: 1 }, { unique: true }),
      // Mongo's TTL monitor deletes expired session records (incl. encrypted private keys).
      sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: SESSION_TTL_SECONDS }),
    ]);
    db = client.db(DB_NAME);

    // getSession() looks sessions up by sessionId on every public-key/decrypt
    // call; without an index that is a full collection scan. Idempotent, and
    // not awaited: a failed build only costs speed, so log it and keep serving.
    db.collection(DB_ENCLAVE_COLLECTION)
      .createIndex({ sessionId: 1 }, { unique: true })
      .catch((error) => getLogger().error({ error: String(error) }, "sessionId index failed"));
  }

  return {
    db,
    ...(await fle()),
  };
}

export interface SessionRecordDocument {
  sessionId: string;
  sessionClientPublicKeyB64: string;
  sessionServerPublicKeyB64: string;
  sessionServerPrivateKeyEnc: Binary;
  sessionServerJwtChainEnc: Binary;
  allowedAudienceRootsEnc: Binary;
  createdAt: Date;
}

export async function storeSession(
  sessionId: string,
  sessionServerKeyPair: BoxKeyPair,
  sessionClientPublicKeyB64: string,
  sessionServerJwtChain: string,
  allowedAudienceRoots: string[],
) {
  const { db, encrypt } = await connectDB();

  const [sessionServerPrivateKeyEnc, sessionServerJwtChainEnc, allowedAudienceRootsEnc] =
    await Promise.all([
      encrypt(sessionServerKeyPair.secretKey),
      encrypt(sessionServerJwtChain),
      encrypt(JSON.stringify(allowedAudienceRoots)),
    ]);

  const record: SessionRecordDocument = {
    sessionId,
    sessionServerPrivateKeyEnc,
    sessionServerPublicKeyB64: Buffer.from(sessionServerKeyPair.publicKey).toString("base64url"),
    sessionClientPublicKeyB64,
    sessionServerJwtChainEnc,
    allowedAudienceRootsEnc,
    createdAt: new Date(),
  };

  await db.collection(DB_ENCLAVE_COLLECTION).insertOne(record);
}

export async function deleteSession(sessionId: string) {
  const { db } = await connectDB();
  await db.collection(DB_ENCLAVE_COLLECTION).deleteOne({ sessionId });
}

export interface Session {
  id: string;
  allowedAudienceRoots: string[];
  sessionClientPublicKey: Uint8Array;
  sessionServerPublicKey: Uint8Array;
  sessionServerPrivateKey: Uint8Array;
  sessionServerJwtChain: string;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const { db, decrypt } = await connectDB();

  const session = await db
    .collection<SessionRecordDocument>(DB_ENCLAVE_COLLECTION)
    .findOne({ sessionId });

  // The TTL monitor runs ~every 60s, so also reject expired records (and legacy ones without createdAt).
  const expiresAt = (session?.createdAt?.getTime() ?? 0) + SESSION_TTL_SECONDS * 1000;
  if (!session || expiresAt < Date.now()) {
    return null;
  }

  const [sessionServerPrivateKey, allowedAudienceRoots, sessionServerJwtChain] = await Promise.all([
    decrypt<Buffer>(session.sessionServerPrivateKeyEnc),
    decrypt<string>(session.allowedAudienceRootsEnc),
    decrypt<string>(session.sessionServerJwtChainEnc),
  ]);

  return {
    id: sessionId,
    allowedAudienceRoots: JSON.parse(allowedAudienceRoots),
    sessionClientPublicKey: Buffer.from(session.sessionClientPublicKeyB64, "base64url"),
    sessionServerPrivateKey,
    sessionServerPublicKey: Buffer.from(session.sessionServerPublicKeyB64, "base64url"),
    sessionServerJwtChain,
  };
}
