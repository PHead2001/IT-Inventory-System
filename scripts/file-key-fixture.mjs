import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { assertLocalUrl } from './runtime.mjs';

export async function installLocalFileKey(status) {
  assertLocalUrl(status.DB_URL, 54322);
  assertLocalUrl(status.API_URL, 54321);
  const keyId = 'e2e' + randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const db = new Client({
    connectionString: status.DB_URL,
    application_name: 'files-e2e-key-install',
  });
  await db.connect();
  try {
    await db.query('begin');
    await db.query(
      'update private.file_keys set accepts_new=false where accepts_new',
    );
    await db.query(
      `insert into private.file_keys(key_id,secret,accepts_new,verify_until)
      values($1,$2,true,now()+interval '2 hours')`,
      [keyId, secret],
    );
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally {
    await db.end();
  }
  return { keyId, secret };
}

export async function retireLocalFileKey(status, keyId) {
  assertLocalUrl(status.DB_URL, 54322);
  const db = new Client({
    connectionString: status.DB_URL,
    application_name: 'files-e2e-key-retire',
  });
  await db.connect();
  try {
    // Published file rows retain an FK to the key ID. Leave that audit tombstone
    // inert, revoke new signatures, and shred the original local-only secret.
    await db.query(
      `update private.file_keys
      set accepts_new=false,verify_until=now(),secret=$2 where key_id=$1`,
      [keyId, randomBytes(32).toString('hex')],
    );
  } finally {
    await db.end();
  }
}
