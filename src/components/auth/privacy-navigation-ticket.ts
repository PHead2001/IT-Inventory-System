/** A single mounted controller owns this wait. It contains no private children. */
export type PrivacyNavigationCapture = {
  provider: symbol;
  destination: string;
  source: string;
  binding: string;
  generation: string;
  serverRevision: string | undefined;
  revision: unknown;
  revocation: number;
  callbacks: number;
  request: number;
};
export type PrivacyNavigationTicket = {
  capture: Readonly<PrivacyNavigationCapture>;
  promise: Promise<void>;
  status: 'pending' | 'verified' | 'retired';
};
export type PrivacyNavigationView = Readonly<{
  capture: Readonly<PrivacyNavigationCapture>;
  status: 'pending' | 'verified';
}> | null;
export function createPrivacyNavigationTickets() {
  let ticket: PrivacyNavigationTicket | null = null;
  let settle: (() => void) | undefined;
  const retire = () => {
    if (ticket) ticket.status = 'retired';
    ticket = null;
    settle?.();
    settle = undefined;
  };
  return {
    snapshot: () => ticket,
    begin(capture: PrivacyNavigationCapture) {
      retire();
      const promise = new Promise<void>((resolve) => {
        settle = resolve;
      });
      ticket = {
        capture: Object.freeze({ ...capture }),
        promise,
        status: 'pending',
      };
      return ticket;
    },
    markVerified(expected: PrivacyNavigationTicket) {
      if (ticket !== expected || expected.status !== 'pending') return false;
      expected.status = 'verified';
      return true;
    },
    settleVerified(expected: PrivacyNavigationTicket) {
      if (ticket !== expected || expected.status !== 'verified' || !settle)
        return false;
      settle?.();
      settle = undefined;
      return true;
    },
    retire(provider?: symbol) {
      if (provider !== undefined && ticket?.capture.provider !== provider)
        return;
      retire();
    },
  };
}
