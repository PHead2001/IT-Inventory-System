import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIRROR_MARKER,
  assertStagingBranch,
  stagingUserPayload,
  syncStagingUsers,
} from '../scripts/staging-user-sync-core.mjs';

const prodUser = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'staff@example.com',
  phone: null,
  password_hash:
    '$2a$10$abcdefghijklmnopqrstuv123456789012345678901234567890',
  email_confirmed: true,
  phone_confirmed: false,
  providers: ['email'],
  user_metadata: { name: 'Staff' },
  app_metadata: { provider: 'email', providers: ['email'] },
  display_name: 'Staff User',
  member_role: 'staff',
  member_active: true,
  can_manage_configuration: false,
  ...overrides,
});

test('staging branch must be the persistent isolated child', () => {
  assert.equal(
    assertStagingBranch([
      {
        project_ref: 'ileoembzjxwhxgtiypec',
        name: 'staging',
        parent_project_ref: 'dndqydmuqoduwaoujfki',
        is_default: false,
        persistent: true,
        git_branch: 'staging',
        status: 'ACTIVE_HEALTHY',
      },
    ]).name,
    'staging',
  );
  assert.throws(
    () =>
      assertStagingBranch([
        {
          project_ref: 'ileoembzjxwhxgtiypec',
          name: 'staging',
          parent_project_ref: 'dndqydmuqoduwaoujfki',
          is_default: false,
          persistent: false,
          git_branch: 'staging',
          status: 'ACTIVE_HEALTHY',
        },
      ]),
    /persistent production child/,
  );
});

test('payload preserves identity and password hash while marking staging ownership', () => {
  const source = {
    id: prodUser().id,
    email: prodUser().email,
    passwordHash: prodUser().password_hash,
    emailConfirmed: true,
    userMetadata: { name: 'Staff' },
    appMetadata: { provider: 'email' },
  };
  assert.deepEqual(stagingUserPayload(source, true), {
    id: source.id,
    email: source.email,
    password_hash: source.passwordHash,
    email_confirm: true,
    user_metadata: source.userMetadata,
    app_metadata: { provider: 'email', [MIRROR_MARKER]: true },
  });
});

test('sync creates missing mirrored users and preserves membership', async () => {
  const calls = [];
  const result = await syncStagingUsers({
    source: {
      users: async ({ offset }) => (offset === 0 ? [prodUser()] : []),
    },
    staging: {
      users: async () => [],
      createUser: async (payload) => {
        calls.push(['create', payload]);
        return {
          id: payload.id,
          email: payload.email,
          app_metadata: payload.app_metadata,
        };
      },
      updateUser: async () => assert.fail('unexpected update'),
      upsertMember: async (membership) => calls.push(['member', membership]),
      deactivateMember: async () => assert.fail('unexpected deactivate'),
    },
  });
  assert.deepEqual(result, {
    source: 1,
    created: 1,
    updated: 0,
    deactivated: 0,
  });
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1].app_metadata[MIRROR_MARKER], true);
  assert.deepEqual(calls[1], [
    'member',
    {
      user_id: prodUser().id,
      display_name: 'Staff User',
      role: 'staff',
      active: true,
      can_manage_configuration: false,
    },
  ]);
});

test('sync updates mirrored users and deactivates removed mirrored memberships only', async () => {
  const removed = '22222222-2222-4222-8222-222222222222';
  const fixture = '33333333-3333-4333-8333-333333333333';
  const calls = [];
  const result = await syncStagingUsers({
    source: {
      users: async ({ offset }) => (offset === 0 ? [prodUser()] : []),
    },
    staging: {
      users: async () => [
        {
          id: prodUser().id,
          email: prodUser().email,
          app_metadata: { [MIRROR_MARKER]: true },
        },
        {
          id: removed,
          email: 'old@example.com',
          app_metadata: { [MIRROR_MARKER]: true },
        },
        {
          id: fixture,
          email: 'test@gmail.com',
          app_metadata: { inventory_preview_fixture: true },
        },
      ],
      createUser: async () => assert.fail('unexpected create'),
      updateUser: async (id, payload) => {
        calls.push(['update', id, payload]);
        return {
          id,
          email: payload.email,
          app_metadata: payload.app_metadata,
        };
      },
      upsertMember: async (membership) =>
        calls.push(['member', membership.user_id]),
      deactivateMember: async (id) => calls.push(['deactivate', id]),
    },
  });
  assert.deepEqual(result, {
    source: 1,
    created: 0,
    updated: 1,
    deactivated: 1,
  });
  assert.deepEqual(calls.at(-1), ['deactivate', removed]);
  assert.equal(calls.some((call) => call[1] === fixture), false);
});

test('sync fails closed on a staging email collision', async () => {
  await assert.rejects(
    syncStagingUsers({
      source: {
        users: async ({ offset }) => (offset === 0 ? [prodUser()] : []),
      },
      staging: {
        users: async () => [
          {
            id: '44444444-4444-4444-8444-444444444444',
            email: prodUser().email,
            app_metadata: {},
          },
        ],
      },
    }),
    /collides with a different user ID/,
  );
});

test('sync refuses to take over an unmarked staging user with the production UUID', async () => {
  await assert.rejects(
    syncStagingUsers({
      source: {
        users: async ({ offset }) => (offset === 0 ? [prodUser()] : []),
      },
      staging: {
        users: async () => [
          {
            id: prodUser().id,
            email: prodUser().email,
            app_metadata: {},
          },
        ],
      },
    }),
    /not owned by the production mirror/,
  );
});

test('invited production users can mirror before a password exists', async () => {
  const calls = [];
  const invited = prodUser({
    password_hash: '',
    email_confirmed: false,
  });
  const result = await syncStagingUsers({
    source: {
      users: async ({ offset }) => (offset === 0 ? [invited] : []),
    },
    staging: {
      users: async () => [],
      createUser: async (payload) => {
        calls.push(payload);
        return {
          id: payload.id,
          email: payload.email,
          app_metadata: payload.app_metadata,
        };
      },
      updateUser: async () => assert.fail('unexpected update'),
      upsertMember: async () => {},
      deactivateMember: async () => assert.fail('unexpected deactivate'),
    },
  });
  assert.deepEqual(result, {
    source: 1,
    created: 1,
    updated: 0,
    deactivated: 0,
  });
  assert.equal('password_hash' in calls[0], false);
  assert.equal(calls[0].email_confirm, false);
});
