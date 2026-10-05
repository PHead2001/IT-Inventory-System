import { randomBytes } from 'node:crypto';
import { PreviewAccessError } from './preview-access-core.mjs';
import {
  assertStagingBranch,
  STAGING_REF,
  STAGING_BRANCH,
  PRODUCTION_REF,
} from './staging-user-sync-core.mjs';
import {
  assertKey,
  assertDeployment,
  fingerprint,
  FILE_ENV,
} from './preview-file-keys.mjs';

export const STAGING_PINS = Object.freeze({
  projectId: 'prj_t7N4Su8pUl2JH6NmAcBsa43MHekK',
  teamId: 'team_fBxB6q3lb8HvuuoYtcWPoaUz',
  repository: 'PHead2001/IT-Inventory-System',
  repoId: 1357600614,
  hostname: 'it-inventory-system-git-staging-phead2002.vercel.app',
});
export const STAGING_KEY_ID = `stf${STAGING_REF}`;
const fail = (code, pending = false) => {
  throw new PreviewAccessError(
    code,
    'Staging file configuration refused',
    pending,
  );
};
export const stagingIntentFor = (
  generation,
  sha,
  backend,
  migration,
  attempt = 1,
) =>
  `inventory-staging-files:v1:${STAGING_REF}:${generation}:${sha}:${backend}:${migration}:${attempt}`;
export function parseStagingIntent(value) {
  const match =
    /^inventory-staging-files:v1:([a-z0-9]{20}):([a-f0-9]{64}):([a-f0-9]{40}):([a-f0-9]{64}):([a-f0-9]{64}):([1-3])$/.exec(
      value ?? '',
    );
  return match
    ? {
        child: match[1],
        generation: match[2],
        sha: match[3],
        backend: match[4],
        migration: match[5],
        attempt: Number(match[6]),
      }
    : null;
}
export function selectStagingFileEnv(response) {
  if (
    !Array.isArray(response?.envs) ||
    response.envs.length > 100 ||
    response.pagination?.next != null
  )
    fail('STAGING_ENV_BOUNDS');
  if (
    response.envs.some(
      (row) =>
        row.key === FILE_ENV &&
        row.gitBranch == null &&
        (!Array.isArray(row.target) || row.target.includes('preview')),
    )
  )
    fail('STAGING_ENV_OWNERSHIP');
  const rows = response.envs.filter(
    (row) =>
      row.key === FILE_ENV &&
      row.gitBranch === STAGING_BRANCH &&
      !(
        Array.isArray(row.target) &&
        row.target.length === 1 &&
        row.target[0] === 'production'
      ),
  );
  if (rows.length > 1) fail('STAGING_ENV_AMBIGUOUS');
  if (!rows.length) return null;
  const row = rows[0];
  const marker = parseStagingIntent(row.comment);
  if (
    !row.id ||
    typeof row.id !== 'string' ||
    !Number.isSafeInteger(row.updatedAt) ||
    row.updatedAt < 0 ||
    row.type !== 'sensitive' ||
    row.visibility !== 'secret' ||
    !Array.isArray(row.target) ||
    row.target.length !== 1 ||
    row.target[0] !== 'preview' ||
    row.customEnvironmentIds?.length ||
    marker?.child !== STAGING_REF
  )
    fail('STAGING_ENV_OWNERSHIP');
  return row;
}
export function assertStagingDeployment(row, context) {
  // Reuse the exact source/environment scope checks without changing PR guards.
  assertDeployment(
    {
      ...row,
      meta: {
        ...row?.meta,
        inventoryPreviewFiles: row?.meta?.inventoryStagingFiles,
      },
    },
    context,
  );
}
function selectDeployment(response, context) {
  if (
    !Array.isArray(response?.deployments) ||
    response.deployments.length > 100 ||
    response.pagination?.next != null
  )
    fail('STAGING_DEPLOYMENT_BOUNDS');
  const rows = response.deployments.filter(
    (row) => row.meta?.inventoryStagingFiles === context.intent,
  );
  if (rows.length > 1) fail('STAGING_DEPLOYMENT_AMBIGUOUS');
  if (!rows.length) return null;
  assertStagingDeployment(rows[0], context);
  return rows[0];
}
function assertProject(project) {
  if (
    project?.id !== STAGING_PINS.projectId ||
    project.accountId !== STAGING_PINS.teamId ||
    project.link?.type !== 'github' ||
    project.link.org !== 'PHead2001' ||
    project.link.repo !== 'IT-Inventory-System' ||
    String(project.link.repoId) !== String(STAGING_PINS.repoId) ||
    project.link.productionBranch !== 'main'
  )
    fail('STAGING_PROJECT_DENIED');
}

// Administrative helper only. Adapters supply fresh authoritative alias and
// served-asset/runtime proof; caller assertions alone are not provider evidence.
export async function provisionStagingFiles(options) {
  const {
    management,
    database,
    vercel,
    expectedSha,
    expectedMigrationRevision,
    expectedCurrentDeployment,
  } = options;
  const reads = options.attempts ?? 100;
  if (
    !/^[a-f0-9]{40}$/.test(expectedSha ?? '') ||
    !/^[a-f0-9]{64}$/.test(expectedMigrationRevision ?? '') ||
    typeof expectedCurrentDeployment !== 'string' ||
    !expectedCurrentDeployment ||
    typeof vercel.runtimeBinding !== 'function' ||
    typeof vercel.currentDeployment !== 'function' ||
    !Number.isSafeInteger(reads) ||
    reads < 1 ||
    reads > 100 ||
    typeof options.pause !== 'function'
  )
    fail('STAGING_INPUT_DENIED');
  let backend;
  let env = selectStagingFileEnv(await vercel.envs());
  let deployment;
  let key;
  let context;
  const verifyRuntime = async (row, purpose = 'current') => {
    const proof = await vercel.runtimeBinding(row.id, purpose);
    if (!proof) fail('STAGING_RUNTIME_PENDING', true);
    if (purpose === 'current' && proof.verificationMode === 'retained')
      fail('STAGING_RUNTIME_PENDING', true);
    if (
      proof.hostname !== STAGING_PINS.hostname ||
      proof.deploymentId !== row.id ||
      proof.sha !== row.gitSource?.sha ||
      proof.branch !== STAGING_BRANCH ||
      proof.backendRef !== STAGING_REF ||
      proof.backendUrl !== `https://${STAGING_REF}.supabase.co` ||
      proof.servedAssetVerified !== true
    )
      fail('STAGING_RUNTIME_DENIED');
  };
  const guard = async () => {
    assertStagingBranch(await management.branches(PRODUCTION_REF));
    assertProject(await vercel.project());
    const fresh = await vercel.assertBackend(
      STAGING_BRANCH,
      STAGING_REF,
      await management.keys(STAGING_REF),
    );
    if (
      !/^[a-f0-9]{64}$/.test(fresh?.fingerprint ?? '') ||
      !Number.isSafeInteger(fresh.updatedAt) ||
      fresh.updatedAt < 0
    )
      fail('STAGING_BACKEND_REVISION');
    if (
      backend &&
      (backend.fingerprint !== fresh.fingerprint ||
        backend.updatedAt !== fresh.updatedAt)
    )
      fail('STAGING_BACKEND_CHANGED');
    backend = fresh;
    if ((await database.schema(STAGING_REF)) !== true)
      fail('STAGING_SCHEMA_DENIED');
    if (
      (await database.migrationRevision(STAGING_REF)) !==
      expectedMigrationRevision
    )
      fail('STAGING_MIGRATION_CHANGED');
    const current = await vercel.currentDeployment(STAGING_PINS.hostname);
    if (
      !current?.id ||
      (current.id !== expectedCurrentDeployment &&
        current.id !== deployment?.id)
    )
      fail('STAGING_DEPLOYMENT_CHANGED');
    if (
      current.projectId !== STAGING_PINS.projectId ||
      current.target != null ||
      current.customEnvironment != null ||
      current.customEnvironmentId != null ||
      current.gitSource?.type !== 'github' ||
      String(current.gitSource.repoId) !== String(STAGING_PINS.repoId) ||
      current.gitSource.ref !== STAGING_BRANCH ||
      !/^[a-f0-9]{40}$/.test(current.gitSource.sha ?? '') ||
      current.readyState !== 'READY'
    )
      fail('STAGING_CURRENT_DENIED');
    await verifyRuntime(current, 'current');
  };
  // Recover a prior POST before checking the alias: Vercel may have already
  // advanced staging to that unique persisted operation's candidate.
  const prior = parseStagingIntent(env?.comment);
  const sameOperation = prior?.sha === expectedSha;
  let priorDeployment;
  let priorContext;
  if (prior) {
    priorContext = {
      projectId: STAGING_PINS.projectId,
      repoId: STAGING_PINS.repoId,
      branch: STAGING_BRANCH,
      sha: prior.sha,
      intent: env.comment,
      backendUpdatedAt: 0,
      intentUpdatedAt: env.updatedAt,
    };
    priorDeployment = selectDeployment(
      await vercel.deployments(priorContext),
      priorContext,
    );
    if (!priorDeployment) fail('STAGING_DEPLOYMENT_UNCERTAIN', true);
    if (sameOperation) deployment = priorDeployment;
  }
  const reconcilePrior = async () => {
    if (!prior || sameOperation) return;
    const fresh = await vercel.deployment(priorDeployment.id);
    assertStagingDeployment(fresh, priorContext);
    if (fresh.id !== priorDeployment.id) fail('STAGING_DEPLOYMENT_DENIED');
    priorDeployment = fresh;
    if (['QUEUED', 'INITIALIZING', 'BUILDING'].includes(fresh.readyState))
      fail('STAGING_PRIOR_PENDING', true);
    if (!['READY', 'ERROR', 'CANCELED'].includes(fresh.readyState))
      fail('STAGING_DEPLOYMENT_UNCERTAIN', true);
    if (fresh.readyState === 'READY')
      await verifyRuntime(fresh, 'prior-completion');
  };
  await guard();
  await reconcilePrior();
  key = assertKey(
    await database.read(STAGING_REF, STAGING_KEY_ID),
    STAGING_KEY_ID,
  );
  if (key?.accepts_new && !env) fail('STAGING_KEY_OWNERSHIP');
  if (env && (!key || prior.generation !== fingerprint(key.secret)))
    fail('STAGING_KEY_OWNERSHIP');
  if (!key) {
    await guard();
    if (selectStagingFileEnv(await vercel.envs())) fail('STAGING_ENV_CHANGED');
    try {
      await database.stage(
        STAGING_REF,
        STAGING_KEY_ID,
        (options.random ?? randomBytes)(32).toString('hex'),
      );
    } catch {
      /* Recover only the persisted secret. */
    }
    key = assertKey(
      await database.read(STAGING_REF, STAGING_KEY_ID),
      STAGING_KEY_ID,
    );
    if (!key) fail('STAGING_STAGE_UNCERTAIN');
  }
  const generation = fingerprint(key.secret);
  if (
    sameOperation &&
    (prior.backend !== backend.fingerprint ||
      prior.migration !== expectedMigrationRevision)
  )
    fail('STAGING_CONFIGURATION_CHANGED');
  const base = {
    projectId: STAGING_PINS.projectId,
    repoId: STAGING_PINS.repoId,
    branch: STAGING_BRANCH,
    sha: expectedSha,
  };
  context = {
    ...base,
    intent: sameOperation
      ? env.comment
      : stagingIntentFor(
          generation,
          expectedSha,
          backend.fingerprint,
          expectedMigrationRevision,
        ),
    backendUpdatedAt: backend.updatedAt,
    intentUpdatedAt: sameOperation ? env.updatedAt : 0,
  };
  deployment = selectDeployment(await vercel.deployments(context), context);
  if (sameOperation === !deployment) fail('STAGING_DEPLOYMENT_UNCERTAIN', true);
  const exact = async () => {
    const freshEnv = selectStagingFileEnv(await vercel.envs());
    if (
      freshEnv?.id !== env?.id ||
      freshEnv?.comment !== env?.comment ||
      freshEnv?.updatedAt !== env?.updatedAt
    )
      fail('STAGING_ENV_CHANGED');
    const freshKey = assertKey(
      await database.read(STAGING_REF, STAGING_KEY_ID),
      STAGING_KEY_ID,
    );
    if (freshKey?.secret !== key.secret) fail('STAGING_KEY_CHANGED');
    return freshKey;
  };
  const freshGuards = async () => {
    await guard();
    await reconcilePrior();
    return exact();
  };
  let posted = false;
  const installAndPost = async () => {
    await freshGuards();
    const oldId = env?.id;
    try {
      await vercel.writeEnv(oldId, {
        key: FILE_ENV,
        value: JSON.stringify({ [STAGING_KEY_ID]: key.secret }),
        type: 'sensitive',
        visibility: 'secret',
        target: ['preview'],
        gitBranch: STAGING_BRANCH,
        comment: context.intent,
      });
    } catch {
      fail('STAGING_ENV_WRITE_UNCERTAIN', true);
    }
    env = selectStagingFileEnv(await vercel.envs());
    if (!env || (oldId && oldId !== env.id) || env.comment !== context.intent)
      fail('STAGING_ENV_WRITE_UNCERTAIN', true);
    context.intentUpdatedAt = env.updatedAt;
    await freshGuards();
    if (posted) fail('STAGING_DEPLOYMENT_UNCERTAIN', true);
    posted = true;
    let created;
    try {
      created = await vercel.createDeployment(context);
    } catch {
      /* Recover exactly one matching persisted operation. */
    }
    if (created) {
      assertStagingDeployment(created, context);
      deployment = created;
    } else {
      deployment = selectDeployment(await vercel.deployments(context), context);
      if (!deployment) fail('STAGING_DEPLOYMENT_UNCERTAIN', true);
    }
  };
  const now = options.now ?? Date.now;
  const deadline = now() + 8 * 60 * 1000;
  const hydrate = async () => {
    const fresh = await vercel.deployment(deployment.id);
    assertStagingDeployment(fresh, context);
    if (fresh.id !== deployment.id) fail('STAGING_DEPLOYMENT_DENIED');
    deployment = fresh;
  };
  const wait = async () => {
    for (let read = 0; read < reads && now() < deadline; read++) {
      await hydrate();
      if (['READY', 'ERROR', 'CANCELED'].includes(deployment.readyState))
        return deployment.readyState;
      if (
        !['QUEUED', 'INITIALIZING', 'BUILDING'].includes(deployment.readyState)
      )
        fail('STAGING_DEPLOYMENT_UNCERTAIN', true);
      if (read + 1 < reads) await options.pause();
    }
    fail('STAGING_DEPLOYMENT_PENDING', true);
  };
  if (!deployment) await installAndPost();
  let status = await wait();
  if (status !== 'READY') {
    if (posted) fail('STAGING_DEPLOYMENT_FAILED');
    const attempt = parseStagingIntent(context.intent).attempt;
    if (attempt >= 3) fail('STAGING_DEPLOYMENT_LIMIT');
    await freshGuards();
    await hydrate();
    if (!['ERROR', 'CANCELED'].includes(deployment.readyState))
      fail('STAGING_DEPLOYMENT_UNCERTAIN', true);
    context = {
      ...base,
      intent: stagingIntentFor(
        generation,
        expectedSha,
        backend.fingerprint,
        expectedMigrationRevision,
        attempt + 1,
      ),
      backendUpdatedAt: backend.updatedAt,
      intentUpdatedAt: 0,
    };
    if (selectDeployment(await vercel.deployments(context), context))
      fail('STAGING_DEPLOYMENT_UNCERTAIN', true);
    await installAndPost();
    status = await wait();
    if (status !== 'READY') fail('STAGING_DEPLOYMENT_FAILED');
  }
  await freshGuards();
  await hydrate();
  if (deployment.readyState !== 'READY')
    fail('STAGING_DEPLOYMENT_PENDING', true);
  await verifyRuntime(deployment, 'current');
  const finalKey = await freshGuards();
  if (!finalKey.accepts_new) {
    try {
      await database.activate(STAGING_REF, STAGING_KEY_ID, key.secret);
    } catch {
      /* Exact readback proves uncertain activation. */
    }
    const active = assertKey(
      await database.read(STAGING_REF, STAGING_KEY_ID),
      STAGING_KEY_ID,
    );
    if (!active?.accepts_new || active.secret !== key.secret)
      fail('STAGING_ACTIVATION_UNCERTAIN', true);
  }
  return {
    branch: STAGING_BRANCH,
    backend: STAGING_REF,
    sha: expectedSha,
    deployment: deployment.id,
    migrationRevision: expectedMigrationRevision,
    backendRevision: backend.fingerprint,
    keyFingerprint: generation,
  };
}
