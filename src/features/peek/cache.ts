import {
  peekEnvelopeSchema,
  peekKey,
  type PeekPayload,
  type PeekTarget,
} from './contracts';
import { PeekNetwork, PeekUnavailable, sharedPeekNetwork } from './network';
export { PeekUnavailable } from './network';
export class PeekAccessLost extends Error {}
type Entry = { payload: PeekPayload; expires: number };
const alwaysCurrent = () => true;
/** Per-provider memory only. One active card, 50 successes, 30 seconds. */
export class PeekCache {
  readonly network;
  private entries = new Map<string, Entry>();
  private pending: {
    key: string;
    ownerCurrent: () => boolean;
    controller: AbortController;
    promise: Promise<PeekPayload>;
  } | null = null;
  private generation = 0;
  private disposed = false;
  private allowed = () => true;
  configureCurrent(current: () => boolean) {
    this.allowed = current;
    if (!current()) this.clear();
  }
  constructor(
    readonly actor: string,
    readonly backend: string,
    private lost: () => void,
    private request: typeof fetch = fetch,
    private now: () => number = Date.now,
    scheduler: PeekNetwork = sharedPeekNetwork,
  ) {
    this.network = scheduler.createScope();
  }
  get(target: PeekTarget) {
    if (this.disposed || !this.allowed()) return null;
    const key = peekKey(target);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.payload;
  }
  expiresIn(target: PeekTarget) {
    return Math.max(
      0,
      (this.entries.get(peekKey(target))?.expires ?? 0) - this.now(),
    );
  }
  cancel() {
    this.generation++;
    this.pending?.controller.abort();
    this.pending = null;
    this.network.cancel();
  }
  clear(target?: PeekTarget) {
    this.cancel();
    if (target) this.entries.delete(peekKey(target));
    else this.entries.clear();
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
  resume() {
    this.disposed = false;
  }
  accessLost() {
    if (this.disposed) return;
    this.clear();
    this.lost();
  }
  async revalidate(
    target: PeekTarget,
    deadline = Date.now() + 5000,
    ownerCurrent: () => boolean = alwaysCurrent,
  ): Promise<PeekPayload> {
    if (this.disposed || !this.allowed() || !ownerCurrent())
      throw new PeekUnavailable();
    const key = peekKey(target);
    if (this.pending?.key === key && this.pending.ownerCurrent === ownerCurrent)
      return this.pending.promise;
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    const current = () =>
      !this.disposed &&
      this.allowed() &&
      ownerCurrent() &&
      generation === this.generation &&
      !controller.signal.aborted;
    const promise = (async () => {
      try {
        const payload = await this.network.run(
          async (signal) => {
            if (!current()) throw new PeekUnavailable();
            const response = await this.request(
              '/api/peek?' + new URLSearchParams(target).toString(),
              { signal, cache: 'no-store', credentials: 'same-origin' },
            );
            if (!current() || signal.aborted) {
              await response.body?.cancel().catch(() => {});
              throw new PeekUnavailable();
            }
            if (
              response.redirected ||
              response.status === 401 ||
              response.status === 403
            ) {
              this.accessLost();
              await response.body?.cancel().catch(() => {});
              throw new PeekAccessLost();
            }
            if (!response.ok) {
              if (current() && !signal.aborted && response.status === 404)
                this.entries.delete(key);
              await response.body?.cancel().catch(() => {});
              throw new PeekUnavailable();
            }
            const envelope = peekEnvelopeSchema.parse(await response.json());
            if (
              current() &&
              !signal.aborted &&
              (envelope.actor !== this.actor ||
                envelope.backend !== this.backend)
            ) {
              this.accessLost();
              throw new PeekAccessLost();
            }
            if (
              !current() ||
              signal.aborted ||
              peekKey(envelope.payload.target) !== key
            )
              throw new PeekUnavailable();
            return envelope.payload;
          },
          deadline,
          controller.signal,
        );
        if (!current()) throw new PeekUnavailable();
        this.entries.delete(key);
        this.entries.set(key, { payload, expires: this.now() + 30000 });
        while (this.entries.size > 50)
          this.entries.delete(this.entries.keys().next().value!);
        return payload;
      } finally {
        if (this.pending?.controller === controller) this.pending = null;
      }
    })();
    this.pending = { key, ownerCurrent, controller, promise };
    return promise;
  }
}
