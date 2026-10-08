import { randomUUID } from 'node:crypto';
import type { Limits, Observation } from '../contracts.ts';
import { EffortCache } from './cache.ts';

export interface CallScope {
  readonly provider: string;
  readonly model: string;
  readonly sessionId: string | undefined;
  readonly token: string | undefined;
}
interface Attempt {
  readonly token: string;
  readonly agent: object;
  readonly nativeId: string;
  readonly sessionId: string;
  scope?: CallScope;
  bindings: number;
  settled: boolean;
  expiresAt: number;
  messageId?: string;
  responseId?: string;
  requests: Map<string, Observation | undefined>;
  blocked: boolean;
}
/** Joins native attempt settlement to capture completion, in either order. */
export class Associations {
  private attempts = new Map<string, Attempt>();
  private active = new Map<string, Set<string>>();
  constructor(private readonly cache: EffortCache, private readonly limits: Limits, private readonly now: () => number = Date.now) {}
  start(agent: object, sessionId: string, nativeId: string): void {
    this.sweep();
    const token = randomUUID();
    const attempt: Attempt = { token, agent, nativeId, sessionId, bindings: 0, settled: false, expiresAt: Infinity, requests: new Map(), blocked: false };
    this.attempts.set(token, attempt);
    const active = this.active.get(sessionId) ?? new Set<string>();
    active.add(token); this.active.set(sessionId, active);
    // A stalled/missing native end cannot accumulate unlimited identity records.
    while (this.attempts.size > this.limits.maxEntries) {
      const oldest = this.attempts.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }
  bind(sessionId: string | undefined, provider: string, model: string, isLoop: boolean): CallScope {
    const candidates = sessionId === undefined ? [] : [...(this.active.get(sessionId) ?? [])].map(key => this.attempts.get(key)).filter((a): a is Attempt => a !== undefined && !a.settled);
    const attempt = isLoop && candidates.length === 1 ? candidates[0] : undefined;
    const scope: CallScope = { sessionId, provider, model, token: attempt?.token };
    if (attempt) { attempt.bindings++; attempt.scope = scope; if (attempt.bindings !== 1) attempt.blocked = true; }
    return scope;
  }
  begin(scope: CallScope): string {
    const id = randomUUID();
    const attempt = scope.token === undefined ? undefined : this.attempts.get(scope.token);
    if (attempt) {
      if (attempt.requests.size >= this.limits.maxConcurrent) attempt.blocked = true;
      else attempt.requests.set(id, undefined);
    }
    return id;
  }
  unavailable(scope: CallScope): void {
    const attempt = scope.token === undefined ? undefined : this.attempts.get(scope.token);
    if (attempt) attempt.blocked = true;
  }
  complete(scope: CallScope, id: string, result: Observation): void {
    if (scope.sessionId) this.cache.putResponse(scope.sessionId, {
      captureId: id, provider: scope.provider, model: scope.model, observedAt: this.now(), result,
    });
    const attempt = scope.token === undefined ? undefined : this.attempts.get(scope.token);
    if (!attempt || !attempt.requests.has(id)) return;
    if (result.kind === 'unknown') attempt.blocked = true;
    attempt.requests.set(id, result); this.publish(attempt);
  }
  end(agent: object, nativeId: string, messageId?: string, responseId?: string): void {
    const matches = [...this.attempts.values()].filter(a => a.agent === agent && a.nativeId === nativeId && !a.settled);
    for (const attempt of matches) {
      attempt.settled = true; attempt.expiresAt = this.now() + this.limits.pendingMs;
      this.active.get(attempt.sessionId)?.delete(attempt.token);
      if (this.active.get(attempt.sessionId)?.size === 0) this.active.delete(attempt.sessionId);
      if (messageId !== undefined) attempt.messageId = messageId;
      if (responseId !== undefined) attempt.responseId = responseId;
      if (!messageId) this.remove(attempt.token);
      else this.publish(attempt);
    }
  }
  abandonAgent(agent: object): void { for (const [key, a] of this.attempts) if (a.agent === agent) this.remove(key); }
  private publish(attempt: Attempt): void {
    if (!attempt.settled || !attempt.messageId || !attempt.scope || [...attempt.requests.values()].some(value => value === undefined)) return;
    let candidates = [...attempt.requests.values()].filter((r): r is Observation => r !== undefined);
    if (candidates.length > 1 && attempt.responseId) candidates = candidates.filter(r => r.kind !== 'unknown' && r.responseId === attempt.responseId);
    if (!attempt.blocked && candidates.length === 1) {
      const result = candidates[0]!;
      const consistent = result.kind === 'unknown' || !result.responseId || !attempt.responseId || result.responseId === attempt.responseId;
      if (consistent) this.cache.put(attempt.sessionId, { messageId: attempt.messageId, provider: attempt.scope.provider, model: attempt.scope.model, observedAt: this.now(), result });
    }
    this.remove(attempt.token);
  }
  sweep(): void { for (const [key, attempt] of this.attempts) if (attempt.expiresAt <= this.now()) this.remove(key); }
  private remove(key: string): void {
    const attempt = this.attempts.get(key);
    if (!attempt) return;
    this.attempts.delete(key); this.active.get(attempt.sessionId)?.delete(key);
    if (this.active.get(attempt.sessionId)?.size === 0) this.active.delete(attempt.sessionId);
  }
  clear(): void { this.attempts.clear(); this.active.clear(); }
  get size(): number { return this.attempts.size; }
}
