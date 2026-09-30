import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { PNG } from 'pngjs';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

function localDatabase() {
  const url = new URL(process.env.LOCAL_DB_URL ?? '');
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  expect(url.port).toBe('54322');
  return new Client({ connectionString: url.toString() });
}

function disposableKey() {
  const entries = Object.entries(
    JSON.parse(process.env.INVENTORY_FILE_KEYS_JSON ?? '{}') as Record<
      string,
      string
    >,
  );
  expect(entries).toHaveLength(1);
  const [id, secret] = entries[0];
  expect(id).toMatch(/^[a-z0-9]{4,32}$/);
  expect(secret.length).toBeGreaterThanOrEqual(32);
  return { id, secret };
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function createAsset(page: Page) {
  await page.goto('/inventory/assets/new');
  const form = page.getByRole('form', { name: 'Create asset inventory' });
  await form
    .getByLabel('Name', { exact: true })
    .fill('Derived recovery ' + randomUUID());
  await chooseLocation(form, 'Current location', 'ITC-RACK');
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
}

function photo(color: number) {
  const image = new PNG({ width: 1024, height: 1024 });
  let noise = color + 1;
  for (let i = 0; i < image.data.length; i += 4) {
    noise ^= noise << 13;
    noise ^= noise >>> 17;
    noise ^= noise << 5;
    image.data[i] = noise & 255;
    image.data[i + 1] = (noise >>> 8) & 255;
    image.data[i + 2] = (noise >>> 16) & 255;
    image.data[i + 3] = 255;
  }
  return PNG.sync.write(image);
}

function storageCompletionFor(path: string) {
  const logs = spawnSync(
    'docker',
    ['logs', '--tail', '300', 'supabase_storage_it-inventory'],
    { encoding: 'utf8', maxBuffer: 4 * 1048576 },
  );
  expect(logs.status).toBe(0);
  const matched: { http: number; errorStatus: number; errorCode: string }[] =
    [];
  for (const line of `${logs.stdout}\n${logs.stderr}`.split('\n')) {
    try {
      const entry = JSON.parse(line) as {
        req?: { method?: string; url?: string };
        res?: { statusCode?: number };
        error?: { statusCode?: number; errorCode?: string };
      };
      if (entry.req?.method === 'POST' && entry.req.url?.includes(path)) {
        matched.push({
          http: entry.res?.statusCode ?? 0,
          errorStatus: entry.error?.statusCode ?? 0,
          errorCode: entry.error?.errorCode ?? '',
        });
      }
    } catch {
      // Storage also writes non-JSON lines. Only this exact path matters.
    }
  }
  return matched;
}

async function upload(files: Locator, name: string, bytes: Buffer) {
  await files.getByLabel('Add photo or PDF').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: bytes,
  });
  await files.getByRole('button', { name: 'Upload and review' }).click();
}

test('Next recovers after a real derived Storage guard rejection', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const key = disposableKey();
  const db = localDatabase();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const functionName = `e2e_expire_derived_${suffix}`;
  const triggerName = `e2e_expire_derived_${suffix}`;
  let installed = false;
  let fileId: string | null = null;
  let original: { accepts_new: boolean; verify_until: Date } | null = null;
  let routeError: Error | null = null;
  let primaryError: unknown = null;
  await db.connect();
  try {
    const initial = await db.query<{
      accepts_new: boolean;
      verify_until: Date;
    }>(
      'select accepts_new,verify_until from private.file_keys where key_id=$1 and secret=$2',
      [key.id, key.secret],
    );
    expect(initial.rows).toHaveLength(1);
    original = initial.rows[0];
    expect(original.accepts_new).toBe(true);
    expect(original.verify_until.getTime()).toBeGreaterThan(Date.now());

    await login(page);
    await createAsset(page);
    const files = page.getByRole('region', { name: 'Inventory files' });
    await page.route('**/rest/v1/rpc/inventory_file_reserve', async (route) => {
      try {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const reservation = (await response.json()) as { id: string };
        expect(reservation.id).toMatch(
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
        );
        fileId = reservation.id;
        await db.query(`create function private.${functionName}() returns trigger
          language plpgsql security definer set search_path='' as $$
          begin
            update private.file_keys set accepts_new=false,
              verify_until=clock_timestamp()-interval '1 second'
              where key_id=(select validation_key_id from public.inventory_files where id=new.file_id)
                and key_id='${key.id}' and accepts_new;
            if not found then raise exception 'disposable E2E key not active'; end if;
            return new;
          end $$`);
        await db.query(`create constraint trigger ${triggerName}
          after insert on private.file_objects deferrable initially deferred
          for each row when (new.file_id='${fileId}'::uuid and new.variant='display')
          execute function private.${functionName}()`);
        installed = true;
        await route.fulfill({ response });
      } catch (error) {
        routeError =
          error instanceof Error ? error : new Error('Fixture route failed');
        await route.abort();
      }
    });

    const failedValidation = page.waitForResponse(
      (response) => response.url().includes('/api/inventory-files/validate'),
      { timeout: 30_000 },
    );
    await upload(files, 'guard-rejected.png', photo(190));
    const failed = await failedValidation;
    expect(routeError).toBeNull();
    expect(installed).toBe(true);
    expect(failed.status()).toBe(409);
    const failureBody = (await failed.json()) as {
      message?: string;
      terminalRejected?: boolean;
    };
    expect(failureBody.message).toBe(
      'The file operation could not be confirmed. Refresh the record before retrying.',
    );
    expect(failureBody.terminalRejected).not.toBe(true);
    expect(fileId).not.toBeNull();
    const denied = await db.query<{
      key_expired: boolean;
      prepared: number;
      stored: number;
      prepared_path: string;
      prepared_bytes: string;
    }>(
      `select (select not accepts_new and verify_until<clock_timestamp()
                from private.file_keys where key_id=$2) key_expired,
        (select count(*)::integer from private.file_objects
          where file_id=$1 and variant='display') prepared,
        (select count(*)::integer from storage.objects so
          join private.file_objects fo on fo.path=so.name and so.bucket_id='inventory-files'
          where fo.file_id=$1 and fo.variant='display') stored,
        (select path from private.file_objects
          where file_id=$1 and variant='display') prepared_path,
        (select bytes::text from private.file_objects
          where file_id=$1 and variant='display') prepared_bytes`,
      [fileId, key.id],
    );
    expect(denied.rows[0].key_expired).toBe(true);
    expect(denied.rows[0].prepared).toBe(1);
    expect(denied.rows[0].stored).toBe(0);
    expect(BigInt(denied.rows[0].prepared_bytes)).toBeGreaterThanOrEqual(
      131072n,
    );
    expect(storageCompletionFor(denied.rows[0].prepared_path)).toContainEqual({
      http: 400,
      errorStatus: 403,
      errorCode: 'AccessDenied',
    });

    await page.unroute('**/rest/v1/rpc/inventory_file_reserve');
    await db.query(`drop trigger ${triggerName} on private.file_objects`);
    await db.query(`drop function private.${functionName}()`);
    installed = false;
    const restored = await db.query(
      `update private.file_keys set accepts_new=$2,verify_until=$3
       where key_id=$1 and secret=$4 and not accepts_new and verify_until<clock_timestamp()`,
      [key.id, original.accepts_new, original.verify_until, key.secret],
    );
    expect(restored.rowCount).toBe(1);
    const api = process.env.LOCAL_API_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(api).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):54321$/);
    expect(anon).toBeTruthy();
    const actor = createClient(api!, anon!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await actor.auth.signInWithPassword({
      email: fixture.emails.staff,
      password: fixture.password,
    });
    expect(signedIn.error).toBeNull();
    const current = await db.query<{
      uploader_id: string;
      validation_generation: number;
      state: string;
    }>(
      'select uploader_id,validation_generation,state from public.inventory_files where id=$1',
      [fileId],
    );
    expect(current.rows[0].state).toBe('validating');
    expect(current.rows[0].uploader_id).toBe(signedIn.data.user!.id);
    const nonce = randomBytes(16).toString('hex');
    const expires = Math.floor(Date.now() / 1000) + 60;
    const generation = current.rows[0].validation_generation;
    const signature = createHmac('sha256', key.secret)
      .update(
        `${current.rows[0].uploader_id}:reject:${fileId}:${generation}:${key.id}:${nonce}:${expires}`,
      )
      .digest('hex');
    const rejected = await actor.rpc('inventory_file_reject', {
      p_file_id: fileId,
      p_generation: generation,
      p_key_id: key.id,
      p_nonce: nonce,
      p_expires: expires,
      p_mac: signature,
    });
    expect(rejected.error).toBeNull();
    const terminal = await db.query<{ state: string }>(
      'select state from public.inventory_files where id=$1',
      [fileId],
    );
    expect(terminal.rows[0].state).toBe('rejected');
    // The worker has returned. Advance only this disposable file's grace clock
    // so normal bounded cleanup can reclaim the physical source bytes.
    const elapsed = await db.query(
      `update public.inventory_files set validation_lease_until=clock_timestamp()-interval '31 seconds'
       where id=$1 and state='rejected'`,
      [fileId],
    );
    expect(elapsed.rowCount).toBe(1);
    let ownSourceDeleted = false;
    for (let attempt = 0; attempt < 5 && !ownSourceDeleted; attempt++) {
      const cleanup = await page.request.post('/api/inventory-files/cleanup');
      expect(cleanup.ok(), JSON.stringify(await cleanup.json())).toBe(true);
      const source = await db.query<{ state: string }>(
        `select cleanup_state state from private.file_objects where file_id=$1 and variant='source'`,
        [fileId],
      );
      ownSourceDeleted = source.rows[0]?.state === 'deleted';
    }
    expect(ownSourceDeleted).toBe(true);
    await page.reload();

    const nextValidation = page.waitForResponse(
      (response) => response.url().includes('/api/inventory-files/validate'),
      { timeout: 30_000 },
    );
    const recoveredPhoto = photo(50);
    expect(recoveredPhoto.length).toBeGreaterThan(1048576);
    await upload(files, 'recovered.png', recoveredPhoto);
    const succeeded = await nextValidation;
    expect(succeeded.ok(), JSON.stringify(await succeeded.json())).toBe(true);
    await expect(
      files.locator('ul').first().getByText('recovered.png', { exact: true }),
    ).toBeVisible();
    await expect(
      files
        .locator('ul')
        .first()
        .getByText(/^ready/),
    ).toBeVisible();
    const publishedVariant = await db.query<{ bytes: string }>(
      `select fo.bytes::text bytes from private.file_objects fo
       join public.inventory_files f on f.id=fo.file_id
       where f.asset_id=(select asset_id from public.inventory_files where id=$1)
         and f.state='ready' and f.original_name='recovered.png'
         and fo.variant='display' order by f.created_at desc limit 1`,
      [fileId],
    );
    expect(BigInt(publishedVariant.rows[0].bytes)).toBeGreaterThanOrEqual(
      131072n,
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let teardownError: unknown = null;
    try {
      await page.unroute('**/rest/v1/rpc/inventory_file_reserve');
      if (installed)
        await db.query(
          `drop trigger if exists ${triggerName} on private.file_objects`,
        );
      await db.query(`drop function if exists private.${functionName}()`);
      if (original) {
        await db.query(
          `update private.file_keys set accepts_new=$2,verify_until=$3
           where key_id=$1 and secret=$4 and not accepts_new and verify_until<clock_timestamp()`,
          [key.id, original.accepts_new, original.verify_until, key.secret],
        );
      }
      if (fileId) {
        const state = await db.query<{
          state: string;
          uploader_id: string;
          validation_generation: number;
        }>(
          'select state,uploader_id,validation_generation from public.inventory_files where id=$1',
          [fileId],
        );
        if (state.rows[0] && state.rows[0].state !== 'ready') {
          const api = process.env.LOCAL_API_URL;
          const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
          expect(api).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):54321$/);
          expect(anon).toBeTruthy();
          const actor = createClient(api!, anon!, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const signedIn = await actor.auth.signInWithPassword({
            email: fixture.emails.staff,
            password: fixture.password,
          });
          expect(signedIn.error).toBeNull();
          expect(signedIn.data.user?.id).toBe(state.rows[0].uploader_id);
          if (state.rows[0].state === 'validating') {
            const nonce = randomBytes(16).toString('hex');
            const expires = Math.floor(Date.now() / 1000) + 60;
            const generation = state.rows[0].validation_generation;
            const signature = createHmac('sha256', key.secret)
              .update(
                `${state.rows[0].uploader_id}:reject:${fileId}:${generation}:${key.id}:${nonce}:${expires}`,
              )
              .digest('hex');
            const rejected = await actor.rpc('inventory_file_reject', {
              p_file_id: fileId,
              p_generation: generation,
              p_key_id: key.id,
              p_nonce: nonce,
              p_expires: expires,
              p_mac: signature,
            });
            expect(rejected.error).toBeNull();
          } else if (
            ['reserved', 'uploaded', 'validated'].includes(state.rows[0].state)
          ) {
            const cancelled = await actor.rpc('inventory_file_cancel', {
              p_file_id: fileId,
            });
            expect(cancelled.error).toBeNull();
          }
          await db.query(
            `update public.inventory_files
               set validation_lease_until=clock_timestamp()-interval '31 seconds'
             where id=$1 and state='rejected'`,
            [fileId],
          );
          const initialSource = await db.query<{ state: string }>(
            `select cleanup_state state from private.file_objects
             where file_id=$1 and variant='source'`,
            [fileId],
          );
          let deleted = initialSource.rows[0]?.state === 'deleted';
          for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
            const cleanup = await page.request.post(
              '/api/inventory-files/cleanup',
              { timeout: 10_000 },
            );
            expect(cleanup.ok()).toBe(true);
            const source = await db.query<{ state: string }>(
              `select cleanup_state state from private.file_objects
               where file_id=$1 and variant='source'`,
              [fileId],
            );
            deleted = source.rows[0]?.state === 'deleted';
          }
          expect(deleted).toBe(true);
        }
      }
    } catch (error) {
      teardownError = error;
    } finally {
      try {
        await db.end();
      } catch (error) {
        teardownError ??= error;
      }
    }
    if (teardownError && !primaryError) throw teardownError;
    if (teardownError)
      console.error(
        'Fictional recovery cleanup also failed:',
        (teardownError as { code?: string }).code ?? 'unknown',
      );
  }
});
