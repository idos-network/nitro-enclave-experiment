import type { Binary, Db } from "mongodb";
import {
  AWS_REGION,
  DB_ARMED_COLLECTION,
  DB_NAME,
  FLE_KEY_ALIAS,
  FLE_KMS_KEY_ID,
  MONGO_URI,
} from "../env.ts";
import { createEncryptedClient } from "../shared/node/db.ts";
import type { ArmRequest } from "../utils/dto.ts";

let db: Db | null = null;

const { client, codec } = createEncryptedClient(MONGO_URI, {
  keyDb: "proxyEncryption",
  keyAlias: FLE_KEY_ALIAS,
  masterKey: { key: FLE_KMS_KEY_ID, region: AWS_REGION },
});

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(DB_NAME);
    // getArmed() looks records up by armedId on every proxy call.
    await db.collection(DB_ARMED_COLLECTION).createIndex({ armedId: 1 }, { unique: true });
  }

  return { db, ...(await codec()) };
}

export interface ArmedRecordDocument {
  armedId: string;
  // Everything (incl. the armedId) in one authenticated FLE blob, so a Mongo
  // writer can neither swap the host key / baseUrl nor copy a blob between records.
  dataEnc: Binary;
  createdAt: Date;
}

export type Armed = ArmRequest & { id: string };

export async function storeArmed(armedId: string, data: ArmRequest) {
  const { db, encrypt } = await connectDB();

  const record: ArmedRecordDocument = {
    armedId,
    dataEnc: await encrypt(JSON.stringify({ armedId, ...data })),
    createdAt: new Date(),
  };

  await db.collection(DB_ARMED_COLLECTION).insertOne(record);
}

export async function getArmed(armedId: string): Promise<Armed | null> {
  const { db, decrypt } = await connectDB();

  const record = await db.collection<ArmedRecordDocument>(DB_ARMED_COLLECTION).findOne({ armedId });

  if (!record) {
    return null;
  }

  const { armedId: blobArmedId, ...data }: ArmRequest & { armedId: string } = JSON.parse(
    await decrypt<string>(record.dataEnc),
  );

  if (blobArmedId !== armedId) {
    throw new Error(`Armed record ${armedId} holds a blob for armedId ${blobArmedId}`);
  }

  return { id: armedId, ...data };
}

/** True when a record was deleted, false when there was none. */
export async function deleteArmed(armedId: string): Promise<boolean> {
  const { db } = await connectDB();
  const { deletedCount } = await db.collection(DB_ARMED_COLLECTION).deleteOne({ armedId });
  return deletedCount === 1;
}
