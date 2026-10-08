import { randomUUID } from 'node:crypto';
import type { EffortItem, Limits, Observation, ResponseItem, Snapshot } from '../contracts.ts';

interface Entry<T> { readonly sessionId: string; readonly item: T; readonly expiresAt: number }
/** Two bounded LRU pools, sharing one coalesced snapshot subscription per Session. */
export class EffortCache {
  private generation = randomUUID();
  private revision = 0;
  private entries = new Map<string, Entry<EffortItem>>();
  private responses = new Map<string, Entry<ResponseItem>>();
  private listeners = new Map<string, Set<() => void>>();
  private stopped = false;
  constructor(private readonly limits: Limits, private readonly now: () => number = Date.now) {}
  private key(sessionId: string, id: string): string { return JSON.stringify([sessionId, id]); }
  put(sessionId: string, item: EffortItem): void {
    if (this.stopped) return;
    this.sweep();
    this.store(this.entries, sessionId, this.key(sessionId, item.messageId), item);
  }
  putResponse(sessionId: string, item: Omit<ResponseItem, 'sequence'>): void {
    if (this.stopped) return;
    this.sweep();
    const key = this.key(sessionId, item.captureId);
    if (this.responses.has(key)) return;
    let last = 0;
    for (const entry of this.responses.values()) if (entry.sessionId === sessionId) last = Math.max(last, entry.item.sequence);
    if (!Number.isSafeInteger(last + 1)) return;
    this.store(this.responses, sessionId, key, { ...item, sequence: last + 1 });
  }
  private store<T extends { readonly result: Observation }>(pool: Map<string, Entry<T>>, sessionId: string, key: string, item: T): void {
    pool.delete(key);
    pool.set(key, { sessionId, item: Object.freeze({ ...item, result: Object.freeze({ ...item.result }) }), expiresAt: this.now() + this.limits.ttlMs });
    const sessionEntries = [...pool].filter(([, entry]) => entry.sessionId === sessionId);
    for (const [old] of sessionEntries.slice(0, Math.max(0, sessionEntries.length - this.limits.maxSessionEntries))) this.remove(pool, old);
    while (pool.size > this.limits.maxEntries) {
      const first = pool.keys().next().value;
      if (first === undefined) break;
      this.remove(pool, first);
    }
    this.changed(sessionId);
  }
  private collect<T>(pool: Map<string, Entry<T>>, sessionId: string): readonly T[] {
    const items: T[] = [];
    for (const [key, entry] of [...pool]) if (entry.sessionId === sessionId) {
      items.push(entry.item);
      pool.delete(key); pool.set(key, entry);
    }
    return Object.freeze(items);
  }
  snapshot(sessionId: string): Snapshot {
    this.sweep();
    return Object.freeze({ generation: this.generation, revision: this.revision, items: this.collect(this.entries, sessionId), responses: this.collect(this.responses, sessionId) });
  }
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.remove(this.entries, key);
    for (const [key, entry] of this.responses) if (entry.expiresAt <= now) this.remove(this.responses, key);
  }
  reset(): void {
    this.entries.clear(); this.responses.clear(); this.generation = randomUUID(); this.revision++;
    for (const listeners of this.listeners.values()) for (const notify of listeners) notify();
  }
  dispose(): void { this.reset(); this.stopped = true; for (const listeners of this.listeners.values()) for (const notify of listeners) notify(); }
  private remove<T>(pool: Map<string, Entry<T>>, key: string): void {
    const entry = pool.get(key);
    if (entry) { pool.delete(key); this.changed(entry.sessionId); }
  }
  private changed(sessionId: string): void {
    this.revision++;
    for (const notify of this.listeners.get(sessionId) ?? []) notify();
  }
  async *watch(sessionId: string, signal: AbortSignal): AsyncGenerator<Snapshot> {
    if (signal.aborted || this.stopped) return;
    let dirty = true;
    let wake: (() => void) | undefined;
    const notify = () => { dirty = true; const resume = wake; wake = undefined; resume?.(); };
    const listeners = this.listeners.get(sessionId) ?? new Set<() => void>();
    this.listeners.set(sessionId, listeners); listeners.add(notify);
    signal.addEventListener('abort', notify);
    try {
      while (!signal.aborted) {
        if (dirty) {
          dirty = false;
          const snapshot = this.snapshot(sessionId);
          const final = this.stopped;
          yield snapshot;
          if (final) return;
        } else if (this.stopped) return;
        else await new Promise<void>(resolve => { wake = resolve; if (dirty || signal.aborted || this.stopped) notify(); });
      }
    } finally {
      signal.removeEventListener('abort', notify); listeners.delete(notify);
      if (listeners.size === 0) this.listeners.delete(sessionId);
    }
  }
  get size(): number { return this.entries.size; }
  get responseSize(): number { return this.responses.size; }
}
