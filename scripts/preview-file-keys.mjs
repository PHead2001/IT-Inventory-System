import { createHash, randomBytes } from 'node:crypto';
import {
  assertPullRequest,
  selectPreviewBranch,
  assertReady,
  PARENT_REF,
  PreviewAccessError,
} from './preview-access-core.mjs';

export const FILE_ENV = 'INVENTORY_FILE_KEYS_JSON';
const fail = (code) => {
  throw new PreviewAccessError(code, 'Preview file configuration refused');
};
export const fingerprint = (secret) =>
  createHash('sha256').update(secret).digest('hex');
export const intentFor = (child, generation, sha, backend, attempt = 1) =>
  `inventory-preview-files:v2:${child}:${generation}:${sha}:${backend}:${attempt}`;
const intentPattern =
  /^inventory-preview-files:v([12]):([a-z0-9]{20}):([a-f0-9]{64}):([a-f0-9]{40}):([a-f0-9]{64})(?::([1-3]))?$/;

export function parseIntent(value) {
  const match = intentPattern.exec(value ?? '');
  if (!match || (match[1] === '1') === Boolean(match[6])) return null;
  return {
    version: Number(match[1]),
    child: match[2],
    generation: match[3],
    sha: match[4],
    backend: match[5],
    attempt: Number(match[6] ?? 1),
  };
}

export function assertProject(project, pins, pr, repository) {
  const [org, repo] = repository.split('/');
  if (
    project?.id !== pins.projectId ||
    project.accountId !== pins.teamId ||
    project.link?.type !== 'github' ||
    project.link.org !== org ||
    project.link.repo !== repo ||
    !Number.isSafeInteger(pr.head.repo.id) ||
    pr.head.repo.id !== pr.base.repo.id ||
    String(project.link.repoId) !== String(pr.head.repo.id) ||
    typeof project.link.productionBranch !== 'string' ||
    project.link.productionBranch === pr.head.ref
  )
    fail('FILE_PROJECT_DENIED');
}

export function selectFileEnv(response, branch) {
  if (
    !Array.isArray(response?.envs) ||
    response.envs.length > 100 ||
    response.pagination?.next != null
  )
    fail('FILE_ENV_BOUNDS');
  if (
    response.envs.some(
      (row) =>
        row.key === FILE_ENV &&
        row.gitBranch == null &&
        row.target?.includes('preview'),
    )
  )
    fail('FILE_ENV_OWNERSHIP');
  const rows = response.envs.filter(
    (row) =>
      row.key === FILE_ENV &&
      row.gitBranch === branch &&
      !(
        Array.isArray(row.target) &&
        row.target.length === 1 &&
        row.target[0] === 'production'
      ),
  );
  if (rows.length > 1) fail('FILE_ENV_AMBIGUOUS');
  if (!rows.length) return null;
  const row = rows[0];
  const marker = parseIntent(row.comment);
  if (
    typeof row.id !== 'string' ||
    !row.id ||
    !Number.isSafeInteger(row.updatedAt) ||
    row.updatedAt < 0 ||
    row.type !== 'sensitive' ||
    row.visibility !== 'secret' ||
    !Array.isArray(row.target) ||
    row.target.length !== 1 ||
    row.target[0] !== 'preview' ||
    row.customEnvironmentIds?.length ||
    !marker
  )
    fail('FILE_ENV_OWNERSHIP');
  return row;
}

export function assertKey(snapshot, id) {
  if (!snapshot || !Array.isArray(snapshot.rows) || snapshot.rows.length > 1)
    fail('FILE_KEY_RESPONSE');
  if (snapshot.foreignActive !== 0) fail('FILE_MANUAL_KEY');
  if (!snapshot.rows.length) return null;
  const row = snapshot.rows[0];
  if (
    row.key_id !== id ||
    !/^[a-f0-9]{64}$/.test(row.secret ?? '') ||
    !(
      (row.accepts_new === false && row.verify_until === '-infinity') ||
      (row.accepts_new === true && row.verify_until === 'infinity')
    )
  )
    fail('FILE_KEY_RETIRED');
  return row;
}

export function selectDeployment(response, context) {
  if (
    !Array.isArray(response?.deployments) ||
    response.deployments.length > 100 ||
    response.pagination?.next != null
  )
    fail('FILE_DEPLOYMENT_BOUNDS');
  const rows = response.deployments.filter(
    (row) => row.meta?.inventoryPreviewFiles === context.intent,
  );
  if (rows.length > 1) fail('FILE_DEPLOYMENT_AMBIGUOUS');
  if (!rows.length) return null;
  assertDeployment(rows[0], context);
  return rows[0];
}

export function assertDeployment(row, context) {
  if (
    !Number.isSafeInteger(context.backendUpdatedAt) ||
    context.backendUpdatedAt < 0 ||
    !Number.isSafeInteger(context.intentUpdatedAt) ||
    context.intentUpdatedAt < 0 ||
    typeof row?.id !== 'string' ||
    !row.id ||
    row.projectId !== context.projectId ||
    row.target != null ||
    row.customEnvironment != null ||
    row.customEnvironmentId != null ||
    row.gitSource?.type !== 'github' ||
    String(row.gitSource.repoId) !== String(context.repoId) ||
    row.gitSource.ref !== context.branch ||
    row.gitSource.sha !== context.sha ||
    row.meta?.inventoryPreviewFiles !== context.intent ||
    !Number.isSafeInteger(row.createdAt ?? row.created) ||
    (row.createdAt ?? row.created) <
      Math.max(context.backendUpdatedAt, context.intentUpdatedAt)
  )
    fail('FILE_DEPLOYMENT_DENIED');
}

// Adapter methods never expose secret-bearing responses to logs. Every write is
// preceded by fresh provider guards; these reads are not a provider transaction.
export async function provisionPreviewFiles(options) {
  const { github, management, database, vercel, repository, number, pins } =
    options;
  let child;
  let pr;
  let backend;
  const guard = async () => {
    pr = assertPullRequest(
      await github.pull(number),
      repository,
      options.expectedSha,
    );
    const branch = selectPreviewBranch(
      await management.branches(PARENT_REF),
      pr,
    );
    if (child && child !== branch.project_ref) fail('FILE_CHILD_CHANGED');
    child = branch.project_ref;
    assertReady(branch, await github.checks(pr.head.sha), pr.head.sha);
    assertProject(await vercel.project(), pins, pr, repository);
    const keys = await management.keys(child);
    const current = await vercel.assertBackend(pr.head.ref, child, keys);
    if (
      !Number.isSafeInteger(current?.updatedAt) ||
      current.updatedAt < 0 ||
      !/^[a-f0-9]{64}$/.test(current.fingerprint ?? '') ||
      !Number.isSafeInteger(current.legacyUpdatedAt) ||
      current.legacyUpdatedAt < 0 ||
      !/^[a-f0-9]{64}$/.test(current.legacyFingerprint ?? '')
    )
      fail('FILE_BACKEND_REVISION');
    if (backend && backend.fingerprint !== current.fingerprint)
      fail('FILE_BACKEND_CHANGED');
    backend = current;
    await database.schema(child);
  };
  await guard();
  options = { ...options, expectedSha: pr.head.sha };
  const id = `pvf${child}`;
  selectFileEnv(await vercel.envs(), pr.head.ref);
  let key = assertKey(await database.read(child, id), id);
  if (!key) {
    await guard();
    selectFileEnv(await vercel.envs(), pr.head.ref);
    try {
      await database.stage(
        child,
        id,
        (options.random ?? randomBytes)(32).toString('hex'),
      );
    } catch {
      // A lost stage response cannot authorize replacing a persisted secret.
    }
    key = assertKey(await database.read(child, id), id);
    if (!key) fail('FILE_STAGE_UNCERTAIN');
  }
  const generation = fingerprint(key.secret);
  const base = {
    projectId: pins.projectId,
    repoId: pr.head.repo.id,
    branch: pr.head.ref,
    sha: pr.head.sha,
    child,
  };
  let env = selectFileEnv(await vercel.envs(), base.branch);
  const marker = parseIntent(env?.comment);
  const sameGeneration =
    marker?.child === child && marker.generation === generation;
  if (
    sameGeneration &&
    marker.version === 1 &&
    marker.backend !== backend.legacyFingerprint
  )
    fail('FILE_BACKEND_CHANGED');
  const sameOperation = sameGeneration && marker.sha === base.sha;
  if (
    sameGeneration &&
    marker.version === 2 &&
    marker.backend !== backend.fingerprint
  )
    fail('FILE_BACKEND_CHANGED');
  let context = {
    ...base,
    intent: sameOperation
      ? env.comment
      : intentFor(child, generation, base.sha, backend.fingerprint),
    backendUpdatedAt:
      sameOperation && marker.version === 1
        ? backend.legacyUpdatedAt
        : backend.updatedAt,
    intentUpdatedAt: sameOperation ? env.updatedAt : 0,
  };
  let deployment = selectDeployment(await vercel.deployments(context), context);
  if (sameOperation && !deployment) fail('FILE_DEPLOYMENT_UNCERTAIN');
  if (!sameOperation && deployment) fail('FILE_DEPLOYMENT_UNCERTAIN');

  const exactEnv = async () => {
    const fresh = selectFileEnv(await vercel.envs(), base.branch);
    if (
      fresh?.id !== env?.id ||
      fresh?.comment !== env?.comment ||
      fresh?.updatedAt !== env?.updatedAt
    )
      fail('FILE_ENV_CHANGED');
  };
  const exactKey = async () => {
    const fresh = assertKey(await database.read(child, id), id);
    if (!fresh || fresh.secret !== key.secret) fail('FILE_KEY_CHANGED');
    return fresh;
  };
  const freshGuards = async () => {
    await guard();
    await exactKey();
    await exactEnv();
  };
  let posted = false;
  const installAndPost = async () => {
    // Advance the persisted marker only after fresh source/backend/key/env proof.
    await freshGuards();
    const body = {
      key: FILE_ENV,
      value: JSON.stringify({ [id]: key.secret }),
      type: 'sensitive',
      visibility: 'secret',
      target: ['preview'],
      gitBranch: base.branch,
      comment: context.intent,
    };
    const previousId = env?.id;
    try {
      await vercel.writeEnv(previousId, body);
    } catch {
      // A committed marker without a deployment remains uncertain on rerun.
      fail('FILE_ENV_WRITE_UNCERTAIN');
    }
    env = selectFileEnv(await vercel.envs(), base.branch);
    if (
      !env ||
      (previousId && env.id !== previousId) ||
      env.comment !== context.intent
    )
      fail('FILE_ENV_WRITE_UNCERTAIN');
    context.intentUpdatedAt = env.updatedAt;
    await freshGuards();
    if (posted) fail('FILE_DEPLOYMENT_UNCERTAIN');
    posted = true;
    try {
      const created = await vercel.createDeployment(context);
      assertDeployment(created, context);
      deployment = created;
    } catch {
      deployment = selectDeployment(await vercel.deployments(context), context);
      if (!deployment) fail('FILE_DEPLOYMENT_UNCERTAIN');
    }
  };
  const now = options.now ?? Date.now;
  const deadline = now() + 8 * 60 * 1000;
  const hydrate = async () => {
    const id = deployment.id;
    const fresh = await vercel.deployment(id);
    assertDeployment(fresh, context);
    if (fresh.id !== id) fail('FILE_DEPLOYMENT_DENIED');
    deployment = fresh;
  };
  const wait = async () => {
    const reads = options.attempts ?? 100;
    for (let read = 0; read < reads; read++) {
      if (now() >= deadline) fail('FILE_DEPLOYMENT_PENDING');
      await hydrate();
      if (['READY', 'ERROR', 'CANCELED'].includes(deployment.readyState))
        return deployment.readyState;
      if (
        !['QUEUED', 'INITIALIZING', 'BUILDING'].includes(deployment.readyState)
      )
        fail('FILE_DEPLOYMENT_UNCERTAIN');
      if (read === reads - 1) fail('FILE_DEPLOYMENT_PENDING');
      await options.pause();
    }
    fail('FILE_DEPLOYMENT_PENDING');
  };
  if (!deployment) await installAndPost();
  let status = await wait();
  const persisted = parseIntent(context.intent);
  const migrateLegacy = persisted.version === 1;
  if (migrateLegacy || status !== 'READY') {
    if (posted) fail('FILE_DEPLOYMENT_FAILED');
    if (persisted.attempt >= 3) fail('FILE_DEPLOYMENT_LIMIT');
    await freshGuards();
    // Hydrate again after the guard before allowing a persisted successor.
    await hydrate();
    status = deployment.readyState;
    if (
      !['READY', 'ERROR', 'CANCELED'].includes(status) ||
      (!migrateLegacy && status === 'READY')
    )
      fail('FILE_DEPLOYMENT_UNCERTAIN');
    context = {
      ...base,
      intent: intentFor(
        child,
        generation,
        base.sha,
        backend.fingerprint,
        persisted.attempt + 1,
      ),
      backendUpdatedAt: backend.updatedAt,
      intentUpdatedAt: 0,
    };
    // A pre-existing successor without its matching persisted env is ambiguous.
    if (selectDeployment(await vercel.deployments(context), context))
      fail('FILE_DEPLOYMENT_UNCERTAIN');
    await installAndPost();
    status = await wait();
    if (status !== 'READY') fail('FILE_DEPLOYMENT_FAILED');
  }
  await freshGuards();
  const finalKey = await exactKey();
  if (!finalKey.accepts_new) {
    await freshGuards();
    try {
      await database.activate(child, id, key.secret);
    } catch {
      // Only an exact fresh readback proves a lost activation response succeeded.
    }
    const active = assertKey(await database.read(child, id), id);
    if (!active?.accepts_new || active.secret !== key.secret)
      fail('FILE_ACTIVATION_UNCERTAIN');
  }
  return {
    branch: child,
    pr: number,
    sha: base.sha,
    deployment: deployment.id,
  };
}
