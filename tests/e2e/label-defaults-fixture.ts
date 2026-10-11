import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isLogoutGeneration } from '../../src/lib/auth/privacy-barrier';
import type { ProtectedPrivacyBinding } from '../../src/lib/auth/protected-binding';
import { isDeepStrictEqual } from 'node:util';
import { expect, type Page, type Route } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { PrintLayout } from '../../src/features/labels/print-layout';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { parseConfigurationCommand } from '../../src/features/configuration/contracts';

type Defaults = {
  size: '90x50' | '70x35';
  page: 'letter' | 'A4';
  format: 'qr' | 'code128';
  layout: PrintLayout | null;
};
type Snapshot = Defaults & { version: string };

// These are the exact argument contracts of the protected Settings privacy
// reads. Payload classification is test routing only, never authorization.
const privacyBindingRead: z.ZodType<ProtectedPrivacyBinding> = z.strictObject({
  actorId: z.uuid(),
  backend: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  }),
  role: z.enum(['viewer', 'staff']),
  canManageConfiguration: z.boolean(),
});
export function isSettingsPrivacyReadArguments(args: unknown): boolean {
  if (!Array.isArray(args)) return false;
  return (
    args.length === 0 ||
    (args.length === 1 &&
      (isLogoutGeneration(args[0]) ||
        privacyBindingRead.safeParse(args[0]).success))
  );
}

export function observedLabelDefaultsCommand(body: string | null) {
  const args: unknown = JSON.parse(body ?? 'null');
  if (!Array.isArray(args) || args.length !== 1)
    throw new Error('Unsupported Settings action serialization');
  const command = parseConfigurationCommand(args[0]);
  if (!command || command.operation !== 'label_defaults_update')
    throw new Error('Invalid observed label defaults command');
  return command;
}

export async function withOwnedLabelDefaults(
  page: Pick<Page, 'route' | 'unroute'>,
  run: (defaults: {
    starting: Snapshot;
    reviewSave: (next: Defaults) => string;
    confirmSaved: () => Promise<void>;
  }) => Promise<void>,
) {
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const caller = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const read = async () => {
    const result = await caller
      .from('configuration_label_defaults')
      .select('size,page,format,layout,version')
      .single();
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    return result.data as Snapshot;
  };
  try {
    const signed = await caller.auth.signInWithPassword({
      email: fixture.emails.staff,
      password: fixture.password,
    });
    expect(signed.error).toBeNull();
    const starting = await read();
    const ownership: {
      reviewed: Snapshot | null;
      submitted: ReturnType<typeof observedLabelDefaultsCommand> | null;
      captureError: unknown;
    } = { reviewed: null, submitted: null, captureError: null };
    const routePattern = '**/settings/labels**';
    const observe = async (route: Route) => {
      const request = route.request();
      if (
        request.method() !== 'POST' ||
        !request.headers()['next-action'] ||
        new URL(request.url()).pathname !== '/settings/labels'
      )
        return route.continue();
      try {
        // The shared gate reads its original binding and logout generation
        // (including acknowledgement) through this same Settings route.
        const args: unknown = JSON.parse(request.postData() ?? 'null');
        if (isSettingsPrivacyReadArguments(args)) return route.continue();
        const command = observedLabelDefaultsCommand(request.postData());
        expect(ownership.reviewed).not.toBeNull();
        const next = ownership.reviewed!;
        expect(command.payload).toEqual({
          expected_version: starting.version,
          size: next.size,
          page: next.page,
          format: next.format,
          layout: next.layout,
        });
        if (ownership.submitted) expect(command).toEqual(ownership.submitted);
        // Record the actual browser request before forwarding it, never a new
        // cleanup intent that could race an original dispatch or late commit.
        ownership.submitted = command;
      } catch (error) {
        ownership.captureError = error;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(routePattern, observe);
    try {
      await run({
        starting,
        reviewSave(next) {
          expect(ownership.reviewed).toBeNull();
          const { version, ...original } = starting;
          // Review the exact intended state before clicking Save, so a failure
          // after the commit but before its UI acknowledgement can still clean up.
          ownership.reviewed = {
            ...next,
            version: (
              BigInt(version) + BigInt(!isDeepStrictEqual(original, next))
            ).toString(),
          };
          return ownership.reviewed.version === version
            ? 'No values changed.'
            : 'Label settings saved.';
        },
        async confirmSaved() {
          expect(ownership.reviewed).not.toBeNull();
          expect(await read()).toEqual(ownership.reviewed);
        },
      });
    } finally {
      try {
        const owned = ownership.reviewed;
        // A later rejected action does not erase ownership of an already
        // validated Save. Settle and restore that intent before reporting it.
        // Without a captured intent, an invalid action must never create a write.
        if (owned && (!ownership.captureError || ownership.submitted)) {
          expect(ownership.submitted).not.toBeNull();
          const command = ownership.submitted!;
          // Replaying the SAME business request settles any in-flight commit.
          // Its receipt also fences an original request dispatched after cleanup.
          // A failed/aborted browser response alone is not transaction completion.
          const settled = await caller.rpc(command.operation, {
            p_request_id: command.requestId,
            p_payload: command.payload,
          });
          expect(settled.error).toBeNull();
          expect(settled.data).toMatchObject({
            version: owned.version,
            changed: owned.version !== starting.version,
          });
          const current = await read();
          expect(current).toEqual(owned);
          if (!isDeepStrictEqual(current, starting)) {
            const restored = await caller.rpc('label_defaults_update', {
              p_request_id: randomUUID(),
              p_payload: {
                expected_version: owned.version,
                size: starting.size,
                page: starting.page,
                format: starting.format,
                layout: starting.layout,
              },
            });
            expect(restored.error).toBeNull();
            expect(await read()).toEqual({
              ...starting,
              version: (BigInt(owned.version) + 1n).toString(),
            });
          }
        }
        if (ownership.captureError) throw ownership.captureError;
      } finally {
        await page.unroute(routePattern, observe);
      }
    }
  } finally {
    const signedOut = await caller.auth.signOut({ scope: 'local' });
    expect(signedOut.error).toBeNull();
  }
}
