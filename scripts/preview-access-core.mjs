// Privileged preview fixture orchestration. Keep this module dependency-free.
export const PARENT_REF = 'dndqydmuqoduwaoujfki';
export const FIXTURE_EMAIL = 'test@gmail.com';
export const CHECK_NAME = 'Supabase Preview';
export const CHECK_APP = 'supabase';
export const MAX_CHECK_RUNS = 100;
export const MAX_AUTH_POLICY_ATTEMPTS = 4;

const refPattern = /^[a-z0-9]{20}$/;
const shaPattern = /^[0-9a-f]{40}$/;

export class PreviewAccessError extends Error {
  constructor(code, message, pending = false, reason) {
    super(message);
    this.code = code;
    this.pending = pending;
    this.reason = reason;
  }
}

// Fixed allowlist only: never print provider bodies, branch fields or errors.
export function previewFailureGuidance(error) {
  if (error?.code === 'BRANCH_PENDING') {
    if (error.reason === 'BRANCH_ABSENT')
      return 'BRANCH_ABSENT: No matching native Supabase child exists. Inspect the Supabase GitHub integration and its PR provisioning result; follow docs/preview-staff-access.md before retrying. Staff workflow_dispatch reconciles an existing child and cannot create one. Capacity refusal is not established by absence alone.';
    if (error.reason === 'BRANCH_UNHEALTHY')
      return 'BRANCH_UNHEALTHY: The matching child exists but is not healthy. Inspect its native Supabase provisioning result and recover that child before retrying staff reconciliation; see docs/preview-staff-access.md.';
  }
  if (error?.code === 'DEPLOYMENT_PENDING')
    return 'DEPLOYMENT_PENDING: The exact PR revision has no successful verified Supabase deployment. Inspect the native Supabase Preview check for the current head SHA and child; after native recovery, retry staff reconciliation. See docs/preview-staff-access.md.';
  return '';
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
      'BRANCH_ABSENT',
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

export function selectDeploymentCheck(response, sha, childRef) {
  if (
    !Number.isSafeInteger(response?.total_count) ||
    response.total_count < 0 ||
    response.total_count > MAX_CHECK_RUNS ||
    !Array.isArray(response.check_runs) ||
    response.check_runs.length !== response.total_count
  )
    throw new PreviewAccessError(
      'CHECKS_INVALID',
      'Supabase check-run listing is incomplete or exceeds its bound',
    );
  const matches = response.check_runs.filter(
    (check) =>
      check?.head_sha === sha &&
      check.name === CHECK_NAME &&
      check.app?.slug === CHECK_APP,
  );
  if (matches.length === 0)
    throw new PreviewAccessError(
      'DEPLOYMENT_PENDING',
      'Supabase deployment for this PR revision is not available',
      true,
    );
  if (matches.some((check) => !Number.isSafeInteger(check.id) || check.id < 1))
    throw new PreviewAccessError('CHECKS_INVALID', 'Check-run ID is invalid');
  matches.sort((a, b) => b.id - a.id);
  if (matches.length > 1 && matches[0].id === matches[1].id)
    throw new PreviewAccessError(
      'CHECKS_AMBIGUOUS',
      'Supabase check-run IDs are duplicated',
    );
  const check = matches[0];
  let url;
  try {
    url = new URL(check.details_url);
  } catch {
    throw new PreviewAccessError(
      'CHECK_TARGET_DENIED',
      'Supabase check is not associated with the selected child project',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'supabase.com' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== `/dashboard/project/${childRef}`
  )
    throw new PreviewAccessError(
      'CHECK_TARGET_DENIED',
      'Supabase check is not associated with the selected child project',
    );
  return check;
}

export function assertReady(branch, checks, sha) {
  if (
    branch.status !== 'ACTIVE_HEALTHY' &&
    branch.preview_project_status !== 'ACTIVE_HEALTHY'
  )
    throw new PreviewAccessError(
      'BRANCH_PENDING',
      'Preview branch is not healthy',
      true,
      'BRANCH_UNHEALTHY',
    );
  const check = selectDeploymentCheck(checks, sha, branch.project_ref);
  if (check.status !== 'completed' || check.conclusion !== 'success') {
    throw new PreviewAccessError(
      'DEPLOYMENT_PENDING',
      'Supabase deployment for this PR revision has not succeeded',
      true,
    );
  }
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
      assertReady(branch, await github.checks(pr.head.sha), pr.head.sha);
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
  const revision = {
    sha: pr.head.sha,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    childRef: branch.project_ref,
  };
  if (pr.number !== number) throw new Error('Preview PR identity changed');
  const revalidate = async () => {
    const freshPr = assertPullRequest(
      await github.pull(number),
      repository,
      revision.sha,
    );
    if (
      freshPr.number !== number ||
      freshPr.head.ref !== revision.headRef ||
      freshPr.base.ref !== revision.baseRef
    )
      throw new Error('Preview PR identity changed');
    const freshBranch = selectPreviewBranch(
      await management.branches(PARENT_REF),
      freshPr,
    );
    if (freshBranch.project_ref !== revision.childRef)
      throw new Error('Preview branch identity changed');
    assertReady(
      freshBranch,
      await github.checks(freshPr.head.sha),
      freshPr.head.sha,
    );
  };
  await revalidate();
  const target = project(revision.childRef);
  const keys = selectKeys(await management.keys(revision.childRef));
  let user = findFixture(await target.listUsers(keys.secret));
  const config = { ...(await management.authConfig(revision.childRef)) };
  const patch = authPolicyPatch(config, password, allowMinimumReduction);
  if (Object.keys(patch).length) {
    await revalidate();
    await management.patchAuthConfig(revision.childRef, patch);
  }
  for (let attempt = 0; attempt < MAX_AUTH_POLICY_ATTEMPTS; attempt += 1) {
    await revalidate();
    if (attempt > 0) {
      const current = await management.authConfig(revision.childRef);
      authPolicyPatch(current, password, false);
      if (
        current.password_min_length !== patch.password_min_length ||
        current.password_required_characters !==
          config.password_required_characters ||
        current.password_hibp_enabled !== config.password_hibp_enabled
      )
        throw new Error('Preview Auth password policy changed');
    }
    const freshUser = findFixture(await target.listUsers(keys.secret));
    if (user && freshUser?.id !== user.id)
      throw new Error('Preview fixture identity changed');
    user = freshUser;
    try {
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
      break;
    } catch (error) {
      // Auth rejects password strength before mutation. Only a length rejection
      // after this invocation's accepted minimum patch can be propagation delay.
      if (
        patch.password_min_length === undefined ||
        error?.code !== 'AUTH_PASSWORD_LENGTH_PENDING' ||
        attempt === MAX_AUTH_POLICY_ATTEMPTS - 1
      )
        throw error;
      await pause();
    }
  }
  if (user?.app_metadata?.inventory_preview_fixture !== true || !user.id)
    throw new Error('Auth did not return the marked fixture user');
  await revalidate();
  await target.upsertMember(keys.secret, {
    user_id: user.id,
    display_name: 'Preview Staff',
    role: 'staff',
    active: true,
    can_manage_configuration: true,
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
    member?.can_manage_configuration !== true
  )
    throw new Error('Fixture membership verification failed');
  return { branch: revision.childRef, pr: number, sha: revision.sha };
}
