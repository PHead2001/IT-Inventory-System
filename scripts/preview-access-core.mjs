// Privileged preview fixture orchestration. Keep this module dependency-free.
export const PARENT_REF = 'dndqydmuqoduwaoujfki';
export const FIXTURE_EMAIL = 'test@gmail.com';
export const CHECK_NAME = 'Supabase Preview';
export const CHECK_APP = 'supabase';

const refPattern = /^[a-z0-9]{20}$/;
const shaPattern = /^[0-9a-f]{40}$/;

export class PreviewAccessError extends Error {
  constructor(code, message, pending = false) {
    super(message);
    this.code = code;
    this.pending = pending;
  }
}

export function assertPullRequest(pr, repository, expectedSha) {
  if (
    !pr ||
    pr.state !== 'open' ||
    pr.head?.repo?.full_name !== repository ||
    pr.base?.repo?.full_name !== repository ||
    !Number.isSafeInteger(pr.number) ||
    pr.number < 1 ||
    typeof pr.head?.ref !== 'string' ||
    !shaPattern.test(pr.head?.sha ?? '') ||
    (expectedSha && pr.head.sha !== expectedSha)
  ) {
    throw new PreviewAccessError(
      'PR_DENIED',
      'PR is closed, forked, retargeted, or stale',
    );
  }
  return pr;
}

export function selectPreviewBranch(branches, pr) {
  if (!Array.isArray(branches)) throw new Error('Branch response is invalid');
  const matches = branches.filter(
    (branch) =>
      branch.git_branch === pr.head.ref && branch.pr_number === pr.number,
  );
  if (matches.length === 0)
    throw new PreviewAccessError(
      'BRANCH_PENDING',
      'Preview branch has not been created',
      true,
    );
  if (matches.length !== 1)
    throw new PreviewAccessError(
      'BRANCH_AMBIGUOUS',
      'PR has multiple matching preview branches',
    );
  const branch = matches[0];
  if (
    branch.parent_project_ref !== PARENT_REF ||
    branch.project_ref === PARENT_REF ||
    branch.is_default !== false ||
    !refPattern.test(branch.project_ref ?? '')
  ) {
    throw new PreviewAccessError(
      'BRANCH_DENIED',
      'Branch is not an isolated child of the configured parent',
    );
  }
  return branch;
}

export function assertReady(branch, check, sha) {
  if (
    branch.status !== 'ACTIVE_HEALTHY' &&
    branch.preview_project_status !== 'ACTIVE_HEALTHY'
  )
    throw new PreviewAccessError(
      'BRANCH_PENDING',
      'Preview branch is not healthy',
      true,
    );
  if (
    !Number.isSafeInteger(branch.latest_check_run_id) ||
    branch.latest_check_run_id < 1 ||
    check?.id !== branch.latest_check_run_id ||
    check.head_sha !== sha ||
    check.name !== CHECK_NAME ||
    check.app?.slug !== CHECK_APP ||
    check.status !== 'completed' ||
    check.conclusion !== 'success'
  ) {
    throw new PreviewAccessError(
      'DEPLOYMENT_PENDING',
      'Supabase deployment for this PR revision has not succeeded',
      true,
    );
  }
}

function checkId(branch) {
  if (
    branch.status !== 'ACTIVE_HEALTHY' &&
    branch.preview_project_status !== 'ACTIVE_HEALTHY'
  )
    throw new PreviewAccessError(
      'BRANCH_PENDING',
      'Preview branch is not healthy',
      true,
    );
  if (
    !Number.isSafeInteger(branch.latest_check_run_id) ||
    branch.latest_check_run_id < 1
  )
    throw new PreviewAccessError(
      'DEPLOYMENT_PENDING',
      'Preview deployment check is not available',
      true,
    );
  return branch.latest_check_run_id;
}

export function authPolicyPatch(config, password, allowMinimumReduction) {
  if (config?.disable_signup !== true)
    throw new Error('Preview Auth signup must remain disabled');
  if (
    typeof config.password_min_length !== 'number' ||
    !Number.isInteger(config.password_min_length)
  )
    throw new Error('Auth password policy is unknown');
  if (
    config.password_required_characters ||
    config.password_hibp_enabled === true
  )
    throw new Error(
      'Preview Auth has another incompatible password rule; review it manually',
    );
  const patch = {};
  if (config.password_min_length > password.length) {
    if (!allowMinimumReduction)
      throw new Error(
        'Preview-only minimum-length reduction needs explicit environment opt-in',
      );
    patch.password_min_length = password.length;
  }
  return patch;
}

export function selectKeys(keys) {
  if (!Array.isArray(keys)) throw new Error('API key response is invalid');
  const secret = keys.filter(
    (key) =>
      key.type === 'secret' &&
      key.name === 'default' &&
      typeof key.api_key === 'string',
  );
  const publishable = keys.filter(
    (key) =>
      key.type === 'publishable' &&
      key.name === 'default' &&
      typeof key.api_key === 'string',
  );
  if (secret.length !== 1 || publishable.length !== 1)
    throw new Error('Preview default secret/publishable keys unavailable');
  return { secret: secret[0].api_key, publishable: publishable[0].api_key };
}

export function findFixture(users) {
  if (!Array.isArray(users)) throw new Error('Auth user response is invalid');
  const matches = users.filter(
    (user) => user.email?.toLowerCase() === FIXTURE_EMAIL,
  );
  if (matches.length > 1) throw new Error('Fixture email is duplicated');
  const user = matches[0];
  if (user && user.app_metadata?.inventory_preview_fixture !== true)
    throw new Error('Fixture email belongs to an unmarked account');
  return user ?? null;
}

export async function provisionPreview({
  repository,
  number,
  expectedSha,
  password,
  allowMinimumReduction = false,
  github,
  management,
  project,
  pause = async () => {},
  attempts = 12,
}) {
  if (
    typeof password !== 'string' ||
    password.length !== 6 ||
    !/^\d+$/.test(password)
  )
    throw new Error('Preview password secret must be six digits');
  let pr;
  let branch;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    pr = assertPullRequest(await github.pull(number), repository, expectedSha);
    try {
      branch = selectPreviewBranch(await management.branches(PARENT_REF), pr);
      assertReady(branch, await github.check(checkId(branch)), pr.head.sha);
      const target = project(branch.project_ref);
      const probeKeys = selectKeys(await management.keys(branch.project_ref));
      try {
        await target.probeSchema(probeKeys.secret);
      } catch (error) {
        if (error?.code !== 'SCHEMA_PENDING') throw error;
        throw new PreviewAccessError(
          'SCHEMA_PENDING',
          'Preview membership schema is not ready',
          true,
        );
      }
      break;
    } catch (error) {
      if (
        !(error instanceof PreviewAccessError) ||
        !error.pending ||
        attempt === attempts - 1
      )
        throw error;
      await pause();
    }
  }
  const revalidate = async () => {
    const freshPr = assertPullRequest(
      await github.pull(number),
      repository,
      pr.head.sha,
    );
    const freshBranch = selectPreviewBranch(
      await management.branches(PARENT_REF),
      freshPr,
    );
    if (freshBranch.project_ref !== branch.project_ref)
      throw new Error('Preview branch identity changed');
    assertReady(
      freshBranch,
      await github.check(checkId(freshBranch)),
      freshPr.head.sha,
    );
  };
  await revalidate();
  const target = project(branch.project_ref);
  const keys = selectKeys(await management.keys(branch.project_ref));
  const users = await target.listUsers(keys.secret);
  let user = findFixture(users);
  const config = await management.authConfig(branch.project_ref);
  const patch = authPolicyPatch(config, password, allowMinimumReduction);
  if (Object.keys(patch).length) {
    await revalidate();
    await management.patchAuthConfig(branch.project_ref, patch);
  }
  await revalidate();
  if (user) {
    user = await target.updateUser(keys.secret, user.id, {
      password,
      email_confirm: true,
      ban_duration: 'none',
    });
  } else {
    user = await target.createUser(keys.secret, {
      email: FIXTURE_EMAIL,
      password,
      email_confirm: true,
      app_metadata: { inventory_preview_fixture: true },
    });
  }
  if (user?.app_metadata?.inventory_preview_fixture !== true || !user.id)
    throw new Error('Auth did not return the marked fixture user');
  await revalidate();
  await target.upsertMember(keys.secret, {
    user_id: user.id,
    display_name: 'Preview Staff',
    role: 'staff',
    active: true,
    can_manage_configuration: false,
  });
  const signedIn = await target.signIn(
    keys.publishable,
    FIXTURE_EMAIL,
    password,
  );
  if (signedIn?.user?.id !== user.id)
    throw new Error('Fixture password sign-in verification failed');
  const member = await target.memberAsUser(
    signedIn.access_token,
    keys.publishable,
    user.id,
  );
  if (
    member?.role !== 'staff' ||
    member?.active !== true ||
    member?.can_manage_configuration !== false
  )
    throw new Error('Fixture membership verification failed');
  return { branch: branch.project_ref, pr: number, sha: pr.head.sha };
}
