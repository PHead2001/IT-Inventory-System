import { describe, expect, it } from 'vitest';
import {
  assignmentCommand,
  assignmentProblem,
  selectedAssignmentSource,
  type AssignmentCandidate,
} from './assign-contracts';
import {
  assignReducer,
  createDetectionGate,
  initialAssignState,
} from './assign-state';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = {
  siteId: id(1),
  siteName: 'Headquarters',
  reference: ' TICKET-1 ',
  sourceId: '',
};
export const candidate: AssignmentCandidate = {
  kind: 'quantity',
  id: id(2),
  path: '/inventory/quantity/' + id(2),
  name: 'Adapter',
  identifier: '00001-A/B',
  version: '7',
  status: 'active',
  currentSite: null,
  sources: [{ id: id(3), name: 'Red', active: false, quantity: 2 }],
};
describe('assignment review/commit state', () => {
  it('rejects late resolution after context changes and freezes unresolved commands against context/source edits', () => {
    const reading = assignReducer(initialAssignState(context), {
      type: 'lookup',
      generation: 1,
    });
    const changed = assignReducer(reading, {
      type: 'context',
      context: { ...context, siteId: id(9) },
      generation: 2,
    });
    expect(
      assignReducer(changed, {
        type: 'candidate',
        generation: 1,
        candidate,
        sourceId: id(3),
      }),
    ).toBe(changed);
    const review = assignReducer(reading, {
      type: 'candidate',
      generation: 1,
      candidate,
      sourceId: id(3),
    });
    const command = assignmentCommand(
      candidate,
      context,
      id(3),
      '1',
      id(4),
      id(5),
    );
    const pending = assignReducer(review, { type: 'pending', command });
    const unknown = assignReducer(pending, {
      type: 'unknown',
      message: 'Lost response',
    });
    expect(
      assignReducer(unknown, { type: 'context', context: null, generation: 3 }),
    ).toBe(unknown);
    expect(assignReducer(unknown, { type: 'edit', units: '2' })).toBe(unknown);
    expect(assignReducer(unknown, { type: 'next', generation: 4 })).toBe(
      unknown,
    );
    expect(assignReducer(unknown, { type: 'pending', command }).command).toBe(
      command,
    );
  });
  it('records a receipt then returns to scanning while retaining batch destination and ticket', () => {
    const review = {
      ...initialAssignState(context),
      phase: 'review' as const,
      candidate,
      sourceId: id(3),
    };
    const command = assignmentCommand(
      candidate,
      context,
      id(3),
      '1',
      id(4),
      id(5),
    );
    const done = assignReducer(
      assignReducer(review, { type: 'pending', command }),
      {
        type: 'committed',
        result: {
          ok: true,
          entityId: candidate.id,
          version: '8',
          changed: true,
        },
      },
    );
    expect(done).toMatchObject({
      phase: 'ready',
      context,
      candidate: null,
      command: null,
      units: '1',
      receipt: { name: 'Adapter' },
    });
  });
  it('requires an explicit source for multiple holdings but retains a valid selected preference', () => {
    const multiple = {
      ...candidate,
      sources: [
        ...candidate.sources,
        { id: id(6), name: 'Black', active: true, quantity: 5 },
      ],
    };
    expect(selectedAssignmentSource(multiple, '')).toBeNull();
    expect(selectedAssignmentSource(multiple, id(6))?.name).toBe('Black');
    expect(selectedAssignmentSource(candidate, '')?.name).toBe('Red');
    const reviewed = {
      ...initialAssignState(context),
      phase: 'review' as const,
      candidate: multiple,
    };
    const selected = assignReducer(reviewed, { type: 'edit', sourceId: id(6) });
    expect(selected.context?.sourceId).toBe(id(6));
    expect(
      assignReducer(selected, { type: 'edit', sourceId: '' }).context?.sourceId,
    ).toBe('');
  });
  it.each(['0', '-1', '1.5', '3', '', '1e0'])(
    'rejects invalid or insufficient quantities %s',
    (units) =>
      expect(assignmentProblem(candidate, id(3), units)).not.toBeNull(),
  );
  it('retains inactive-source evacuation, review version and exact identifiers without normalizing internal values', () => {
    expect(
      assignmentCommand(candidate, context, id(3), '1', id(4), id(5)),
    ).toMatchObject({
      expectedActorId: id(4),
      requestId: id(5),
      payload: {
        expected_version: '7',
        source_location_id: id(3),
        reference: 'TICKET-1',
        quantity: 1,
      },
    });
    expect(
      assignmentProblem(
        { ...candidate, kind: 'asset', currentSite: 'Other site' },
        id(3),
        '1',
      ),
    ).toMatch(/already assigned/);
    expect(
      assignmentProblem({ ...candidate, status: 'retired' }, id(3), '1'),
    ).toMatch(/retired/);
  });
});
it('suppresses held camera labels until observed loss/reentry or explicit rescan and never queues while busy', () => {
  const gate = createDetectionGate();
  expect(gate.observe('label-A', true)).toBe(true);
  expect(gate.observe('label-A', true)).toBe(false);
  expect(gate.observe('label-B', false)).toBe(false);
  expect(gate.observe('label-A', true)).toBe(false);
  gate.observe(null, true);
  gate.observe(null, true);
  gate.observe(null, true);
  expect(gate.observe('label-A', true)).toBe(true);
  gate.rescan();
  expect(gate.observe('label-A', true)).toBe(true);
});
