export const PRODUCTION_REF = 'dndqydmuqoduwaoujfki';
export const STAGING_REF = 'ileoembzjxwhxgtiypec';
export const STAGING_BRANCH = 'staging';
export const MIRROR_MARKER = 'inventory_staging_mirror';
export const PAGE_SIZE = 200;
export const MAX_USERS = 10000;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertStagingBranch(branches) {
  if (!Array.isArray(branches)) throw new Error('Staging branch listing is invalid');
  const matches = branches.filter(
    (branch) =>
      branch?.project_ref === STAGING_REF &&
      branch?.name === STAGING_BRANCH,
  );
  if (matches.length !== 1) throw new Error('Staging branch identity is ambiguous');
  const branch = matches[0];
  if (
    branch.parent_project_ref !== PRODUCTION_REF ||
    branch.is_default !== false ||
    branch.persistent !== true ||
    branch.git_branch !== STAGING_BRANCH ||
    (branch.status !== 'ACTIVE_HEALTHY' &&
      branch.preview_project_status !== 'ACTIVE_HEALTHY')
  )
    throw new Error('Staging branch is not the healthy persistent production child');
  return branch;
}

export function normalizeSourceUser(row) {
  if (
    !row ||
    typeof row !== 'object' ||
    !uuidPattern.test(row.id ?? '') ||
    typeof row.email !== 'string' ||
    !row.email.includes('@') ||
    row.phone != null ||
    typeof row.password_hash !== 'string' ||
    row.password_hash.length < 20 ||
    row.password_hash.length > 1024 ||
    typeof row.email_confirmed !== 'boolean' ||
    typeof row.phone_confirmed !== 'boolean' ||
    !Array.isArray(row.providers) ||
    row.providers.length !== 1 ||
    row.providers[0] !== 'email' ||
    !row.user_metadata ||
    typeof row.user_metadata !== 'object' ||
    Array.isArray(row.user_metadata) ||
    !row.app_metadata ||
    typeof row.app_metadata !== 'object' ||
    Array.isArray(row.app_metadata) ||
    typeof row.display_name !== 'string' ||
    !['viewer', 'staff'].includes(row.member_role) ||
    typeof row.member_active !== 'boolean' ||
    typeof row.can_manage_configuration !== 'boolean'
  )
    throw new Error('Production user is outside the supported staging mirror contract');
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    emailConfirmed: row.email_confirmed,
    userMetadata: row.user_metadata,
    appMetadata: row.app_metadata,
    membership: {
      user_id: row.id,
      display_name: row.display_name,
      role: row.member_role,
      active: row.member_active,
      can_manage_configuration: row.can_manage_configuration,
    },
  };
}

export function stagingUserPayload(source, includeId) {
  const payload = {
    email: source.email,
    password_hash: source.passwordHash,
    email_confirm: source.emailConfirmed,
    user_metadata: source.userMetadata,
    app_metadata: {
      ...source.appMetadata,
      [MIRROR_MARKER]: true,
    },
  };
  if (includeId) payload.id = source.id;
  return payload;
}

export async function syncStagingUsers({ source, staging }) {
  const sourceUsers = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await source.users({ limit: PAGE_SIZE, offset });
    if (!Array.isArray(page) || page.length > PAGE_SIZE)
      throw new Error('Production user page is invalid');
    sourceUsers.push(...page.map(normalizeSourceUser));
    if (sourceUsers.length > MAX_USERS)
      throw new Error('Production user mirror exceeds its safety bound');
    if (page.length < PAGE_SIZE) break;
  }

  const ids = new Set();
  const emails = new Set();
  for (const user of sourceUsers) {
    const email = user.email.toLowerCase();
    if (ids.has(user.id) || emails.has(email))
      throw new Error('Production user mirror contains duplicate identity');
    ids.add(user.id);
    emails.add(email);
  }

  const stagingUsers = await staging.users();
  if (!Array.isArray(stagingUsers) || stagingUsers.length > MAX_USERS)
    throw new Error('Staging Auth listing is invalid');
  const byId = new Map(stagingUsers.map((user) => [user.id, user]));
  const byEmail = new Map(
    stagingUsers
      .filter((user) => typeof user.email === 'string')
      .map((user) => [user.email.toLowerCase(), user]),
  );

  let created = 0;
  let updated = 0;
  let deactivated = 0;

  for (const user of sourceUsers) {
    const existingById = byId.get(user.id);
    const existingByEmail = byEmail.get(user.email.toLowerCase());
    if (existingByEmail && existingByEmail.id !== user.id)
      throw new Error('Staging Auth email collides with a different user ID');
    let result;
    if (existingById) {
      if (
        typeof existingById.email === 'string' &&
        existingById.email.toLowerCase() !== user.email.toLowerCase()
      )
        throw new Error('Staging Auth user ID collides with a different email');
      result = await staging.updateUser(
        user.id,
        stagingUserPayload(user, false),
      );
      updated += 1;
    } else {
      result = await staging.createUser(stagingUserPayload(user, true));
      created += 1;
    }
    if (result?.id !== user.id)
      throw new Error('Staging Auth did not preserve the production user ID');
    await staging.upsertMember(user.membership);
  }

  for (const user of stagingUsers) {
    if (
      user?.app_metadata?.[MIRROR_MARKER] === true &&
      uuidPattern.test(user.id ?? '') &&
      !ids.has(user.id)
    ) {
      await staging.deactivateMember(user.id);
      deactivated += 1;
    }
  }

  return { source: sourceUsers.length, created, updated, deactivated };
}
