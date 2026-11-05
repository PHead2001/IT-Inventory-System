import { expect, it, vi } from 'vitest';
import { createTransientFeedback } from './transient-feedback-state';

function setup() {
  let visible = true;
  const feedback = createTransientFeedback(() => visible);
  const owner = {};
  feedback.register(owner);
  return {
    feedback,
    owner,
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
    },
  };
}
it('binds tickets to exact owners and retry identities and consumes each channel once', () => {
  const { feedback, owner } = setup();
  const ticket = feedback.begin(owner, 'retry');
  const confirmation = { kind: 'details-saved' as const, eventId: 'commit' };
  expect(feedback.confirm(ticket, {}, 'retry', confirmation)).toBe(false);
  expect(feedback.confirm(ticket, owner, 'other', confirmation)).toBe(false);
  expect(
    feedback.confirm(ticket, owner, 'retry', confirmation, 'checkmark'),
  ).toBe(true);
  expect(feedback.confirm(ticket, owner, 'retry', confirmation)).toBe(true);
  expect(feedback.confirm(ticket, owner, 'retry', confirmation)).toBe(false);
  expect(
    feedback.confirm(ticket, owner, 'retry', confirmation, 'checkmark'),
  ).toBe(false);
  expect(feedback.snapshot()).toHaveLength(1);
});
it('returns the same retry ticket without resetting claims and retires prior operation internals on a new operation', () => {
  const { feedback, owner } = setup();
  const first = feedback.begin(owner, 'first');
  const result = { kind: 'details-saved' as const, eventId: 'private-event' };
  expect(feedback.confirm(first, owner, 'first', result)).toBe(true);
  expect(feedback.begin(owner, 'first')).toBe(first);
  expect(feedback.confirm(first, owner, 'first', result)).toBe(false);
  const second = feedback.begin(owner, 'second');
  expect(feedback.confirm(first, owner, 'first', result, 'checkmark')).toBe(
    false,
  );
  expect(
    feedback.confirm(second, owner, 'second', {
      kind: 'label-added',
      additionId: 'new-add',
      count: '1',
    }),
  ).toBe(true);
  expect(feedback.snapshot()).toHaveLength(2);
});
it.each(['dispose', 'withdraw'] as const)(
  'clears ticket/host ownership synchronously on %s while an opaque ticket is still held',
  (kind) => {
    const { feedback, owner } = setup();
    const predicate = vi.fn(() => true);
    feedback.register(owner, predicate);
    const ticket = feedback.begin(owner, 'private-retry');
    feedback.confirm(ticket, owner, 'private-retry', {
      kind: 'details-saved',
      eventId: 'private-event',
    });
    if (kind === 'dispose') feedback.dispose(owner);
    else feedback.withdraw();
    predicate.mockClear();
    expect(feedback.hasOwner(owner)).toBe(false);
    expect(feedback.snapshot()).toEqual([]);
    expect(
      feedback.confirm(ticket, owner, 'private-retry', {
        kind: 'details-saved',
        eventId: 'private-event',
      }),
    ).toBe(false);
    expect(feedback.begin(owner, 'private-retry')).toBeNull();
    expect(predicate).not.toHaveBeenCalled();
  },
);
it('rejects A-B-A completion replay but allows a deliberately new operation', () => {
  const { feedback, owner } = setup();
  const ticket = feedback.begin(owner, 'retry');
  for (const eventId of ['A', 'B', 'A'])
    feedback.confirm(ticket, owner, 'retry', {
      kind: 'details-saved',
      eventId,
    });
  expect(feedback.snapshot()).toHaveLength(1);
  expect(
    feedback.confirm(feedback.begin(owner, 'fresh'), owner, 'fresh', {
      kind: 'details-saved',
      eventId: 'C',
    }),
  ).toBe(true);
});
it('consumes a suppressed completion and never queues saturated notices', () => {
  const { feedback, owner } = setup();
  for (let i = 0; i < 3; i++)
    feedback.confirm(feedback.begin(owner, String(i)), owner, String(i), {
      kind: 'details-saved',
      eventId: String(i),
    });
  const ticket = feedback.begin(owner, 'full');
  expect(
    feedback.confirm(ticket, owner, 'full', {
      kind: 'details-saved',
      eventId: 'full',
    }),
  ).toBe(false);
  feedback.remove(feedback.snapshot()[0].id);
  expect(
    feedback.confirm(ticket, owner, 'full', {
      kind: 'details-saved',
      eventId: 'full',
    }),
  ).toBe(false);
  expect(feedback.snapshot()).toHaveLength(2);
});
it('consumes hidden outcomes even without a withdrawal notification', () => {
  const { feedback, owner, hide, show } = setup();
  const ticket = feedback.begin(owner, 'retry');
  hide();
  expect(
    feedback.confirm(ticket, owner, 'retry', {
      kind: 'details-saved',
      eventId: 'event',
    }),
  ).toBe(false);
  show();
  expect(
    feedback.confirm(ticket, owner, 'retry', {
      kind: 'details-saved',
      eventId: 'event',
    }),
  ).toBe(false);
});
it.each(['withdraw', 'dispose'] as const)(
  'retires delayed callbacks on %s, including same owner reentry',
  (kind) => {
    const { feedback, owner } = setup();
    const ticket = feedback.begin(owner, 'retry');
    if (kind === 'withdraw') feedback.withdraw();
    else {
      feedback.dispose(owner);
      feedback.register(owner);
    }
    expect(
      feedback.confirm(ticket, owner, 'retry', {
        kind: 'details-saved',
        eventId: 'event',
      }),
    ).toBe(false);
    expect(feedback.snapshot()).toEqual([]);
  },
);
it.each(['0', '-1', '1.5', '01', '1e3', 'record name', ''])(
  'rejects invalid label counts %s without keeping a payload',
  (count) => {
    const { feedback, owner } = setup();
    const ticket = feedback.begin(owner, 'retry');
    expect(
      feedback.confirm(ticket, owner, 'retry', {
        kind: 'label-added',
        additionId: 'add',
        count,
      }),
    ).toBe(false);
    expect(feedback.snapshot()).toEqual([]);
  },
);
