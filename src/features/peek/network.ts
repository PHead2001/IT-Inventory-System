export class PeekUnavailable extends Error {}

type Job = { start: () => void; controller: AbortController };
/** A provider's cancellation owner; it never owns or resets physical slots. */
export class PeekNetworkScope {
  private readonly owner = Symbol('peek-network-scope');
  constructor(private readonly scheduler: PeekNetwork) {}
  run<T>(
    operation: (signal: AbortSignal) => PromiseLike<T>,
    deadline: number,
    callerSignal?: AbortSignal,
  ) {
    return this.scheduler.run(operation, deadline, callerSignal, this.owner);
  }
  cancel() {
    this.scheduler.cancel(this.owner);
  }
}
/** API fetch+body and authenticated Storage blob consumption share two slots.
 * Logical cancellation never frees a physical slot before actual settlement. */
export class PeekNetwork {
  private physical = 0;
  private queue: Job[] = [];
  private readonly defaultOwner = Symbol('peek-network-default');
  private controllers = new Map<AbortController, symbol>();
  createScope() {
    return new PeekNetworkScope(this);
  }
  cancel(owner = this.defaultOwner) {
    this.controllers.forEach((candidate, controller) => {
      if (candidate === owner) controller.abort();
    });
  }
  run<T>(
    operation: (signal: AbortSignal) => PromiseLike<T>,
    deadline: number,
    callerSignal?: AbortSignal,
    owner = this.defaultOwner,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const remaining = deadline - Date.now();
      if (callerSignal?.aborted || remaining <= 0) {
        reject(new PeekUnavailable());
        return;
      }
      const controller = new AbortController();
      this.controllers.set(controller, owner);
      let finished = false;
      const timer = setTimeout(() => controller.abort(), remaining);
      const callerAbort = () => controller.abort();
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.controllers.delete(controller);
        callerSignal?.removeEventListener('abort', callerAbort);
        controller.signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        if (finished) return;
        finished = true;
        this.queue = this.queue.filter((candidate) => candidate !== job);
        cleanup();
        reject(new PeekUnavailable());
      };
      const job: Job = {
        controller,
        start: () => {
          if (finished || controller.signal.aborted) return;
          this.physical++;
          const settle = (value: T | undefined, error?: unknown) => {
            this.physical--;
            if (!finished) {
              finished = true;
              cleanup();
              if (error !== undefined) reject(error);
              else resolve(value as T);
            }
            this.drain();
          };
          void Promise.resolve()
            .then(() => {
              if (controller.signal.aborted) throw new PeekUnavailable();
              return operation(controller.signal);
            })
            .then(
              (value) => settle(value),
              (error) => settle(undefined, error),
            );
        },
      };
      controller.signal.addEventListener('abort', abort, { once: true });
      callerSignal?.addEventListener('abort', callerAbort, { once: true });
      this.queue.push(job);
      this.drain();
    });
  }
  private drain() {
    while (this.physical < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      if (!job.controller.signal.aborted) job.start();
    }
  }
}

// This scheduler holds only pending operations and cancellation ownership, never
// cached summaries or blob URLs. Physical slots survive provider replacement.
export const sharedPeekNetwork = new PeekNetwork();
