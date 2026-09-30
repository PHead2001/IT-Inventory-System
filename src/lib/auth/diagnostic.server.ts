import 'server-only';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export type AuthDiagnosticStage =
  | 'login.total'
  | 'login.client'
  | 'login.credentials'
  | 'login.getUser'
  | 'login.membership'
  | 'member.total'
  | 'member.client'
  | 'member.getUser'
  | 'member.membership'
  | 'proxy.getClaims'
  | 'inventory.pageMembership'
  | 'inventory.parallelReads'
  | 'inventory.search'
  | 'inventory.categories'
  | 'inventory.locations'
  | 'inventory.sites'
  | 'inventory.fileSummaries'
  | 'cookie.getAll'
  | 'cookie.setAll';
const stages: ReadonlySet<AuthDiagnosticStage> = new Set([
  'login.total',
  'login.client',
  'login.credentials',
  'login.getUser',
  'login.membership',
  'member.total',
  'member.client',
  'member.getUser',
  'member.membership',
  'proxy.getClaims',
  'inventory.pageMembership',
  'inventory.parallelReads',
  'inventory.search',
  'inventory.categories',
  'inventory.locations',
  'inventory.sites',
  'inventory.fileSummaries',
  'cookie.getAll',
  'cookie.setAll',
]);
export type AuthDiagnostic = { readonly correlation: string };

function loopbackDatabase() {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Explicitly opt in on an isolated preview or local loopback only. */
export function authDiagnosticsEnabled() {
  if (process.env.AUTH_DIAGNOSTICS !== '1') return false;
  if (process.env.VERCEL_ENV === 'production') return false;
  if (process.env.VERCEL_ENV === 'preview') return true;
  return (
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV &&
    process.env.APP_ENV === 'local' &&
    loopbackDatabase()
  );
}

export function createAuthDiagnostic(): AuthDiagnostic | null {
  if (!authDiagnosticsEnabled()) return null;
  try {
    return { correlation: randomUUID() };
  } catch {
    // Instrumentation failure must never alter authentication.
    return null;
  }
}

function report(
  diagnostic: AuthDiagnostic | null,
  stage: AuthDiagnosticStage,
  start: number,
) {
  if (!diagnostic) return;
  if (!stages.has(stage)) return;
  try {
    const elapsed = performance.now() - start;
    if (!Number.isFinite(elapsed)) return;
    console.info(
      'AUTH_DIAGNOSTIC ' +
        JSON.stringify({
          correlation: diagnostic.correlation,
          stage,
          durationMs: Math.max(0, Math.round(elapsed * 10) / 10),
        }),
    );
  } catch {
    // Logging is best effort and cannot change the caller's outcome.
  }
}

export async function observeAuthStage<T>(
  diagnostic: AuthDiagnostic | null,
  stage: AuthDiagnosticStage,
  operation: () => T,
): Promise<Awaited<T>> {
  if (!diagnostic) return await operation();
  let start: number;
  try {
    start = performance.now();
  } catch {
    return await operation();
  }
  try {
    return await operation();
  } finally {
    report(diagnostic, stage, start);
  }
}

export function observeAuthStageSync<T>(
  diagnostic: AuthDiagnostic | null,
  stage: AuthDiagnosticStage,
  operation: () => T,
): T {
  if (!diagnostic) return operation();
  let start: number;
  try {
    start = performance.now();
  } catch {
    return operation();
  }
  try {
    return operation();
  } finally {
    report(diagnostic, stage, start);
  }
}
