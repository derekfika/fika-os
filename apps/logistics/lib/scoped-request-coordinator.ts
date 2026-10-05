export type ScopedRequestContext = Readonly<{ scope: string; generation: number }>;

/**
 * Keeps asynchronous reads, their deduplication, and their UI commits within
 * the scope and generation that started them. A result may complete after a
 * scope switch, but its commit callback will no longer run.
 */
export class ScopedRequestCoordinator {
  private generation = 0;
  private active?: ScopedRequestContext;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  activate(scope: string): ScopedRequestContext {
    this.active = Object.freeze({ scope, generation: ++this.generation });
    return this.active;
  }

  capture(): ScopedRequestContext | undefined {
    return this.active;
  }

  isCurrent(context: ScopedRequestContext): boolean {
    return this.active?.scope === context.scope && this.active.generation === context.generation;
  }

  commit(context: ScopedRequestContext, apply: () => void): boolean {
    if (!this.isCurrent(context)) return false;
    apply();
    return true;
  }

  has(context: ScopedRequestContext): boolean {
    return this.inFlight.has(`${context.scope}\u0000${context.generation}`);
  }

  run<T>(context: ScopedRequestContext, task: () => Promise<T>): Promise<T> {
    const key = `${context.scope}\u0000${context.generation}`;
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = task();
    this.inFlight.set(key, pending);
    void pending.finally(() => {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }).catch(() => undefined);
    return pending;
  }
}

export function scopedRequestKey(context: ScopedRequestContext): string {
  return `${context.scope}:${context.generation}`;
}
