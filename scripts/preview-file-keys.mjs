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
export const intentFor = (child, generation, sha, backend) =>
  `inventory-preview-files:v1:${child}:${generation}:${sha}:${backend}`;
const intentPattern =
  /^inventory-preview-files:v1:([a-z0-9]{20}):([a-f0-9]{64}):([a-f0-9]{40}):([a-f0-9]{64})$/;

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
  const marker = intentPattern.exec(row.comment ?? '');
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
    const currentBackend = await vercel.assertBackend(pr.head.ref, child);
    if (
      !Number.isSafeInteger(currentBackend?.updatedAt) ||
      currentBackend.updatedAt < 0 ||
      !/^[a-f0-9]{64}$/.test(currentBackend.fingerprint ?? '')
    )
      fail('FILE_BACKEND_REVISION');
    if (backend && backend.fingerprint !== currentBackend.fingerprint)
      fail('FILE_BACKEND_CHANGED');
    backend = currentBackend;
    await database.schema(child);
  };
  await guard();
  // Freeze a manually dispatched run to its first observed SHA as well.
  options = { ...options, expectedSha: pr.head.sha };
  const id = `pvf${child}`;
  selectFileEnv(await vercel.envs(), pr.head.ref);
  let key = assertKey(await database.read(child, id), id);
  if (!key) {
    await guard();
    try {
      await database.stage(
        child,
        id,
        (options.random ?? randomBytes)(32).toString('hex'),
      );
    } catch {
      // An insert can have committed despite a lost HTTP response. Read it back;
      // never replace a persisted secret, including on subsequent invocations.
    }
    key = assertKey(await database.read(child, id), id);
    if (!key) fail('FILE_STAGE_UNCERTAIN');
  }
  const generation = fingerprint(key.secret);
  const intent = intentFor(child, generation, pr.head.sha, backend.fingerprint);
  const context = {
    projectId: pins.projectId,
    repoId: pr.head.repo.id,
    branch: pr.head.ref,
    sha: pr.head.sha,
    child,
    intent,
    backendUpdatedAt: backend.updatedAt,
  };
  let env = selectFileEnv(
    await vercel.envs(),
    context.branch,
    child,
    generation,
  );
  context.intentUpdatedAt = env?.comment === intent ? env.updatedAt : 0;
  let deployment = selectDeployment(await vercel.deployments(context), context);
  const priorMarker = env && intentPattern.exec(env.comment);
  if (
    priorMarker &&
    priorMarker[1] === child &&
    priorMarker[2] === generation &&
    priorMarker[4] !== backend.fingerprint
  )
    fail('FILE_BACKEND_CHANGED');
  const previousIntent = env?.comment === intent;
  // An existing intent without a matching deployment is an external ambiguity:
  // a pre-POST crash and a lost POST response cannot safely be distinguished.
  if (previousIntent && !deployment) fail('FILE_DEPLOYMENT_UNCERTAIN');
  await guard();
  const fresh = selectFileEnv(
    await vercel.envs(),
    context.branch,
    child,
    generation,
  );
  if (fresh?.id !== env?.id || fresh?.comment !== env?.comment)
    fail('FILE_ENV_CHANGED');
  const body = {
    key: FILE_ENV,
    value: JSON.stringify({ [id]: key.secret }),
    type: 'sensitive',
    visibility: 'secret',
    target: ['preview'],
    gitBranch: context.branch,
    comment: intent,
  };
  if (deployment) {
    if (!previousIntent) fail('FILE_DEPLOYMENT_UNCERTAIN');
    context.intentUpdatedAt = env.updatedAt;
    assertDeployment(deployment, context);
  } else {
    // A comment alone is never proof of the secret value. Write the persisted
    // database generation before recording a new deployment operation.
    try {
      await vercel.writeEnv(env?.id, body);
    } catch {
      fail('FILE_ENV_WRITE_UNCERTAIN');
    }
    env = selectFileEnv(await vercel.envs(), context.branch);
    if (!env || env.comment !== intent || !Number.isSafeInteger(env.updatedAt))
      fail('FILE_ENV_WRITE_UNCERTAIN');
    context.intentUpdatedAt = env.updatedAt;
  }
  if (!deployment) {
    await guard();
    const beforePost = selectFileEnv(await vercel.envs(), context.branch);
    if (
      beforePost?.id !== env.id ||
      beforePost.comment !== intent ||
      beforePost.updatedAt !== env.updatedAt
    )
      fail('FILE_ENV_CHANGED');
    try {
      const created = await vercel.createDeployment(context);
      assertDeployment(created, context);
      deployment = created;
    } catch {
      deployment = selectDeployment(await vercel.deployments(context), context);
      if (!deployment) fail('FILE_DEPLOYMENT_UNCERTAIN');
    }
  }
  const now = options.now ?? Date.now;
  const deadline = now() + 8 * 60 * 1000;
  const attempts = options.attempts ?? 100;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (now() >= deadline) fail('FILE_DEPLOYMENT_PENDING');
    deployment = await vercel.deployment(deployment.id);
    assertDeployment(deployment, context);
    if (deployment.readyState === 'READY') break;
    if (['ERROR', 'CANCELED'].includes(deployment.readyState))
      fail('FILE_DEPLOYMENT_FAILED');
    if (attempt === attempts - 1) fail('FILE_DEPLOYMENT_PENDING');
    await options.pause();
  }
  await guard();
  const finalEnv = selectFileEnv(
    await vercel.envs(),
    context.branch,
    child,
    generation,
  );
  if (
    finalEnv?.id !== env.id ||
    finalEnv.comment !== intent ||
    finalEnv.updatedAt !== env.updatedAt
  )
    fail('FILE_ENV_CHANGED');
  const finalKey = assertKey(await database.read(child, id), id);
  if (!finalKey || finalKey.secret !== key.secret) fail('FILE_KEY_CHANGED');
  if (!finalKey.accepts_new) {
    await guard();
    try {
      await database.activate(child, id, key.secret);
    } catch {
      // A committed activation may have lost its HTTP response. Only the fresh
      // exact-state readback below can establish success.
    }
    const active = assertKey(await database.read(child, id), id);
    if (!active?.accepts_new || active.secret !== key.secret)
      fail('FILE_ACTIVATION_UNCERTAIN');
  }
  return {
    branch: child,
    pr: number,
    sha: context.sha,
    deployment: deployment.id,
  };
}
