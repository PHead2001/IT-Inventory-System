import { beforeEach, expect, it } from 'vitest';
import {
  parseAssignmentRecovery,
  readAssignmentRecovery,
  storeAssignmentRecovery,
  clearAssignmentRecovery,
  type AssignmentRecovery,
} from './assign-recovery';
import { assignmentCommand } from './assign-contracts';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  actor: id(1),
  origin: 'https://preview.example',
  backend: 'https://isolated.supabase.co',
};
const context = { siteId: id(2), siteName: 'HQ', sourceId: '', reference: '' };
const candidate = {
  kind: 'quantity' as const,
  id: id(3),
  path: '/inventory/quantity/' + id(3),
  name: 'Adapter',
  identifier: '0001',
  version: '7',
  status: 'active' as const,
  currentSite: null,
  sources: [{ id: id(4), name: 'Red', active: true, quantity: 2 }],
};
const stored: AssignmentRecovery = {
  version: 1,
  scope,
  context,
  candidate,
  sourceId: id(4),
  units: '1',
  command: assignmentCommand(
    candidate,
    context,
    id(4),
    '1',
    scope.actor,
    id(5),
  ),
};
beforeEach(() => sessionStorage.clear());
it('retains one exact unknown command without cross-actor/environment reads or replacement', () => {
  expect(storeAssignmentRecovery(stored, null)).toBe(true);
  expect(readAssignmentRecovery(scope).value?.command).toEqual(stored.command);
  expect(readAssignmentRecovery({ ...scope, actor: id(9) }).value).toBeNull();
  expect(
    readAssignmentRecovery({ ...scope, backend: 'https://other.supabase.co' })
      .value,
  ).toBeNull();
  expect(
    storeAssignmentRecovery(
      { ...stored, command: { ...stored.command, requestId: id(7) } },
      null,
    ),
  ).toBe(false);
  expect(clearAssignmentRecovery(scope, id(7))).toBe(false);
  expect(clearAssignmentRecovery(scope, id(5))).toBe(true);
});
it('rejects forged review versions, destinations, actor and unsupported keys', () => {
  for (const command of [
    { ...stored.command, expectedActorId: id(9) },
    {
      ...stored.command,
      payload: { ...stored.command.payload, expected_version: '8' },
    },
    {
      ...stored.command,
      payload: { ...stored.command.payload, destination_site_id: id(9) },
    },
    {
      ...stored.command,
      payload: { ...stored.command.payload, reference: 'unreviewed' },
    },
  ])
    expect(
      parseAssignmentRecovery(JSON.stringify({ ...stored, command }), scope),
    ).toBeNull();
  expect(
    parseAssignmentRecovery(
      JSON.stringify({ ...stored, secret: 'excluded' }),
      scope,
    ),
  ).toBeNull();
  expect(
    parseAssignmentRecovery(
      JSON.stringify({
        ...stored,
        candidate: { ...candidate, path: '/inventory/quantity/' + id(9) },
      }),
      scope,
    ),
  ).toBeNull();
});
