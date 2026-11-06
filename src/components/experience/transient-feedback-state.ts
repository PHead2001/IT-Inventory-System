export type FeedbackConfirmation =
  | { kind: 'details-saved'; eventId: string }
  | { kind: 'label-added'; additionId: string; count: string };
// Tickets carry no payload, authority or serializable replay identity.
export type FeedbackTicket = Readonly<{ token: symbol }>;
export type FeedbackBusinessOwner = object;
export type FeedbackNotice = {
  id: number;
  owner: FeedbackBusinessOwner;
  confirmation: FeedbackConfirmation;
  open: boolean;
};

export function confirmationText(value: FeedbackConfirmation) {
  return value.kind === 'details-saved'
    ? 'Details saved.'
    : value.count === '1'
      ? 'Added 1 label to the queue.'
      : `Added ${value.count} labels to the queue.`;
}
function valid(value: FeedbackConfirmation) {
  return value.kind === 'details-saved'
    ? typeof value.eventId === 'string' &&
        value.eventId.length > 0 &&
        value.eventId.length <= 200
    : value.kind === 'label-added' &&
        typeof value.additionId === 'string' &&
        value.additionId.length > 0 &&
        value.additionId.length <= 200 &&
        typeof value.count === 'string' &&
        /^[1-9]\d{0,5}$/.test(value.count);
}

/** Provider-local, bounded visible notices; suppressed confirmations still consume tickets. */
export function createTransientFeedback(current: () => boolean) {
  type Operation = {
    owner?: FeedbackBusinessOwner;
    retry: string;
    claims: Set<'toast' | 'checkmark'>;
    confirmation?: string;
    registration?: Registration;
    ticket: FeedbackTicket;
    active: boolean;
  };
  type Registration = { current: () => boolean; operation?: Operation };
  let tickets = new WeakMap<FeedbackTicket, Operation>();
  let owners = new WeakMap<FeedbackBusinessOwner, Registration>();
  const retire = (operation: Operation | undefined) => {
    if (!operation) return;
    operation.active = false;
    operation.owner = undefined;
    operation.retry = '';
    operation.confirmation = undefined;
    operation.registration = undefined;
    operation.claims.clear();
  };
  let notices: FeedbackNotice[] = [];
  let serial = 0;
  const listeners = new Set<() => void>();
  const renders = new Set<() => void>();
  const flushRender = () => renders.forEach((listener) => listener());
  const publish = (notifyRender = true) => {
    listeners.forEach((listener) => listener());
    if (notifyRender) flushRender();
  };
  return {
    admitted: () => current(),
    configureCurrent(next: () => boolean) {
      current = next;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeRender(listener: () => void) {
      renders.add(listener);
      return () => {
        renders.delete(listener);
      };
    },
    flushRender,
    snapshot: () => notices,
    hasOwner: (owner: FeedbackBusinessOwner) => owners.has(owner),
    register(owner: FeedbackBusinessOwner, ownerCurrent = current) {
      const previous = owners.get(owner);
      if (previous) {
        retire(previous.operation);
        previous.current = () => false;
      }
      owners.set(owner, { current: ownerCurrent });
    },
    dispose(owner: FeedbackBusinessOwner, notifyRender = true) {
      const previous = owners.get(owner);
      if (previous) {
        retire(previous.operation);
        previous.operation = undefined;
        previous.current = () => false;
      }
      owners.delete(owner);
      const next = notices.filter((notice) => notice.owner !== owner);
      if (next.length !== notices.length) {
        notices = next;
        publish(notifyRender);
      }
    },
    begin(owner: FeedbackBusinessOwner, retry: string): FeedbackTicket | null {
      if (
        !current() ||
        !owners.get(owner)?.current() ||
        !retry ||
        retry.length > 200
      )
        return null;
      const registration = owners.get(owner)!;
      if (
        registration.operation?.active &&
        registration.operation.retry === retry
      )
        return registration.operation.ticket;
      retire(registration.operation);
      const ticket = Object.freeze({ token: Symbol('feedback-operation') });
      const operation: Operation = {
        active: true,
        ticket,
        owner,
        retry,
        claims: new Set(),
        registration,
      };
      registration.operation = operation;
      tickets.set(ticket, operation);
      return ticket;
    },
    confirm(
      ticket: FeedbackTicket | null,
      owner: FeedbackBusinessOwner,
      retry: string,
      confirmation: FeedbackConfirmation,
      channel: 'toast' | 'checkmark' = 'toast',
    ) {
      if (!ticket) return false;
      const operation = tickets.get(ticket);
      if (
        !operation?.active ||
        operation.owner !== owner ||
        operation.retry !== retry ||
        owners.get(owner) !== operation.registration ||
        operation.claims.has(channel)
      )
        return false;
      // Consume even when hidden, malformed, full or superseded. No delayed backlog.
      operation.claims.add(channel);
      const fingerprint = JSON.stringify(confirmation);
      if (
        !valid(confirmation) ||
        (operation.confirmation !== undefined &&
          operation.confirmation !== fingerprint)
      )
        return false;
      operation.confirmation = fingerprint;
      if (!current() || !operation.registration?.current()) return false;
      if (channel === 'checkmark') return true;
      if (notices.length === 3) return false;
      notices = [
        ...notices,
        { id: ++serial, owner, confirmation: { ...confirmation }, open: true },
      ];
      publish();
      return true;
    },
    dismiss(id: number) {
      if (!notices.some((notice) => notice.id === id && notice.open)) return;
      notices = notices.map((notice) =>
        notice.id === id ? { ...notice, open: false } : notice,
      );
      publish();
    },
    remove(id: number) {
      const next = notices.filter((notice) => notice.id !== id);
      if (next.length !== notices.length) {
        notices = next;
        publish();
      }
    },
    withdraw(notifyRender = true) {
      tickets = new WeakMap();
      owners = new WeakMap();
      if (notices.length) {
        notices = [];
        publish(notifyRender);
      }
    },
  };
}
