/**
 * A tiny typed event bus. Systems talk through events instead of importing each other:
 * combat emits `hit`/`kill`, loot listens to `kill` to drop items, audio/particles/UI
 * listen to everything. Agents can log the bus (`bus.onAny`) to see what a level did.
 */
export class EventBus<E extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof E, Set<(payload: never) => void>>();
  private readonly any = new Set<(type: keyof E, payload: unknown) => void>();

  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as (payload: never) => void);
    return () => set.delete(fn as (payload: never) => void);
  }

  onAny(fn: (type: keyof E, payload: unknown) => void): () => void {
    this.any.add(fn);
    return () => this.any.delete(fn);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (set) for (const fn of [...set]) (fn as (p: E[K]) => void)(payload);
    for (const fn of this.any) fn(type, payload);
  }

  clear(): void {
    this.handlers.clear();
    this.any.clear();
  }
}
