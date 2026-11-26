export type ReadState<T> = {
  status: "idle" | "loading" | "ready" | "error";
  value?: T;
  error?: Error;
};

export class StudioReadResource<T> {
  private state: ReadState<T> = { status: "idle" };
  private listeners = new Set<() => void>();
  private pending?: Promise<T>;
  private generation = 0;
  private verifiedAt = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  snapshot = () => this.state;

  private publish(state: ReadState<T>) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  load(read: () => Promise<T>, maxAge: number, force = false, preserveValue = false): Promise<T> {
    if (this.pending) return this.pending;
    if (!force && this.state.status === "ready" && Date.now() - this.verifiedAt < maxAge) {
      return Promise.resolve(this.state.value!);
    }
    const generation = this.generation;
    const previous = preserveValue ? this.state.value : undefined;
    this.publish({ status: "loading", value: previous });
    const pending = Promise.resolve().then(read).then(value => {
      if (generation !== this.generation) throw new Error("A newer catalogue or draft request replaced this request.");
      this.set(value);
      return value;
    }).catch((error: Error) => {
      if (generation === this.generation) this.publish({ status: "error", error, value: previous });
      throw error;
    }).finally(() => {
      if (this.pending === pending) this.pending = undefined;
    });
    this.pending = pending;
    return pending;
  }

  set(value: T) {
    this.generation++;
    this.pending = undefined;
    this.verifiedAt = Date.now();
    this.publish({ status: "ready", value });
  }

  invalidate(error?: Error) {
    this.generation++;
    this.pending = undefined;
    this.verifiedAt = 0;
    this.publish(error ? { status: "error", error } : { status: "idle" });
  }
}
