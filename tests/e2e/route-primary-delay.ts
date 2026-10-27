import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import type { TestInfo } from '@playwright/test';
import { e2eScheduling, parallelSpecs } from '../../scripts/e2e-scheduling';

type FixtureContext = {
  db: string | undefined;
  api: string | undefined;
  hosted: boolean;
  project: string;
  workers: number;
  projectWorkers: number;
  fullyParallel: boolean;
  parallelDependsOnExclusive: boolean;
  projectNames: string[];
  canonicalConfig: boolean;
};
/** Refuse hosted targets and scheduling overrides before connecting or issuing SQL. */
export function localPrimaryDelayTarget(context: FixtureContext) {
  assert(!context.hosted, 'Primary-delay fixture is local only.');
  assert(
    context.canonicalConfig,
    'Primary-delay fixture requires the canonical Playwright configuration.',
  );
  assert(
    context.db && context.api,
    'Canonical local fixture endpoints are required.',
  );
  let db: URL, api: URL;
  try {
    db = new URL(context.db);
    api = new URL(context.api);
  } catch {
    throw new Error('Invalid canonical local fixture endpoint.');
  }
  assert(
    ['localhost', '127.0.0.1'].includes(db.hostname) &&
      db.port === '45322' &&
      db.pathname === '/postgres' &&
      !db.search &&
      !db.hash &&
      ['postgres:', 'postgresql:'].includes(db.protocol),
    'Primary-delay fixture requires the canonical loopback local database.',
  );
  assert(
    ['localhost', '127.0.0.1'].includes(api.hostname) &&
      api.port === '45321' &&
      !api.search &&
      !api.hash &&
      api.protocol === 'http:',
    'Primary-delay fixture requires the canonical loopback local API.',
  );
  assert(
    !new Set<string>(parallelSpecs).has('route-motion.spec.ts'),
    'Route motion must remain outside parallel specs.',
  );
  assert(
    !context.fullyParallel,
    'Primary-delay fixture requires exclusive specs.',
  );
  const focused =
    context.project === 'chromium' &&
    context.workers === 1 &&
    context.projectWorkers === 1 &&
    context.projectNames.length === 1 &&
    context.projectNames[0] === 'chromium';
  const full =
    context.project === 'chromium-exclusive' &&
    context.workers === 2 &&
    context.projectWorkers === 1 &&
    context.projectNames.length === 2 &&
    context.projectNames.includes('chromium-exclusive') &&
    context.projectNames.includes('chromium-parallel') &&
    context.parallelDependsOnExclusive;
  assert(
    focused || full,
    'Primary-delay fixture requires the canonical single-worker exclusive phase.',
  );
  return db.href;
}

/** No DDL/data changes. Two local sessions hold and independently observe a real primary read. */
export async function withHeldQuantityPrimary<T>(
  info: TestInfo,
  run: (held: {
    release: () => Promise<void>;
    blockedReads: () => Promise<number>;
  }) => Promise<T>,
) {
  // FullProject intentionally omits scheduling internals. The checked canonical
  // config imports this policy unchanged; inspect only supported resolved fields.
  const policy = e2eScheduling(process.env.E2E_FULL_SUITE === '1');
  const project = policy.projects.find(
    (entry) => entry.name === info.project.name,
  );
  const target = localPrimaryDelayTarget({
    db: process.env.LOCAL_DB_URL,
    api: process.env.LOCAL_API_URL,
    hosted: !!process.env.VERCEL,
    project: info.project.name,
    workers: info.config.workers,
    projectWorkers: project?.workers ?? policy.workers,
    fullyParallel: info.config.fullyParallel,
    parallelDependsOnExclusive: !!info.config.projects
      .find((project) => project.name === 'chromium-parallel')
      ?.dependencies.includes('chromium-exclusive'),
    projectNames: info.config.projects.map((project) => project.name),
    canonicalConfig:
      !!info.config.configFile &&
      resolve(info.config.configFile) ===
        fileURLToPath(new URL('../../playwright.config.ts', import.meta.url)),
  });
  const holder = new Client({
    connectionString: target,
    connectionTimeoutMillis: 1000,
  });
  const observer = new Client({
    connectionString: target,
    connectionTimeoutMillis: 1000,
  });
  let holderConnected = false,
    observerConnected = false,
    transaction = false;
  let asynchronousFailure: Error | undefined;
  holder.on('error', (error: Error) => {
    asynchronousFailure = error;
  });
  observer.on('error', (error: Error) => {
    asynchronousFailure = error;
  });
  const release = async () => {
    if (!transaction) return;
    transaction = false;
    await holder.query('rollback');
  };
  try {
    await holder.connect();
    holderConnected = true;
    await observer.connect();
    observerConnected = true;
    await holder.query('begin');
    transaction = true;
    await holder.query("set local lock_timeout = '500ms'");
    await holder.query("set local statement_timeout = '1000ms'");
    // Hard failure protection; this is not an application readiness timer.
    await holder.query(
      "set local idle_in_transaction_session_timeout = '3000ms'",
    );
    await holder.query(
      'lock table public.quantity_items in access exclusive mode',
    );
    const {
      rows: [{ pid }],
    } = await holder.query<{ pid: number }>('select pg_backend_pid() as pid');
    await observer.query("set statement_timeout = '500ms'");
    const acquired = performance.now();
    const result = await run({
      release,
      blockedReads: async () => {
        assert(
          performance.now() - acquired < 2500,
          'Primary-delay observation exceeded its bounded hold.',
        );
        if (asynchronousFailure) throw asynchronousFailure;
        const observed = await observer.query<{ count: string }>(
          "select count(distinct a.pid) from pg_stat_activity a join pg_locks l on l.pid = a.pid where $1 = any(pg_blocking_pids(a.pid)) and a.wait_event_type = 'Lock' and l.relation = 'public.quantity_items'::regclass and not l.granted and a.query like '%quantity_items%'",
          [pid],
        );
        return Number(observed.rows[0].count);
      },
    });
    if (asynchronousFailure) throw asynchronousFailure;
    return result;
  } finally {
    try {
      await release();
    } finally {
      try {
        if (observerConnected) await observer.end();
      } finally {
        if (holderConnected) await holder.end();
      }
    }
  }
}
