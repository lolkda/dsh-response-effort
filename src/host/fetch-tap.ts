import type { Observation, Settings } from '../contracts.ts';
import { calls } from './call-context.ts';
import type { CallScope } from './association.ts';
import { EffortParser } from './sse-parser.ts';

const OWNER = Symbol.for('dsh-response-effort.fetch-owner.v1');
type FetchGlobal = typeof globalThis & { [OWNER]?: FetchTap };
export interface CaptureSink {
  begin(scope: CallScope): string;
  complete(scope: CallScope, id: string, result: Observation): void;
  unavailable?(scope: CallScope): void;
}
interface ReaderJob { cancel: () => void; readonly done: Promise<void> }
/** A no-body-inspection request filter and a bounded, cancellable response observer. */
export class FetchTap {
  private previous: typeof fetch | undefined;
  private wrapper: typeof fetch | undefined;
  private active = false;
  private inFlight = 0;
  private jobs = new Set<ReaderJob>();
  readonly stats = { matched: 0, observed: 0, absent: 0, unknown: 0, skipped: 0 };
  constructor(private readonly config: Settings, private readonly sink: CaptureSink) {}
  install(): void {
    const host = globalThis as FetchGlobal;
    if (host[OWNER]) throw new Error('response-effort already owns a fetch observer');
    this.previous = globalThis.fetch;
    const original = this.previous;
    this.active = true;
    this.wrapper = async (input, init) => {
      const scope = calls.getStore();
      let matched = false;
      try {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        matched = this.active && this.config.enabled && scope !== undefined && method.toUpperCase() === 'POST' && this.allowed(scope.provider, url);
      } catch { /* A filter failure must not replace the original fetch outcome. */ }
      // Network errors and aborts come exclusively from the original transport.
      let response: Response;
      try { response = await original(input, init); }
      catch (error) { if (matched && scope) this.unavailable(scope); throw error; }
      if (!matched || !this.active || !scope) return response;
      try {
        if (response.url && !this.allowed(scope.provider, response.url)) { this.unavailable(scope); return response; }
        if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/event-stream' || response.body === null) { this.unavailable(scope); return response; }
        this.stats.matched++;
        if (this.inFlight >= this.config.limits.maxConcurrent) { this.stats.skipped++; this.unavailable(scope); return response; }
        const id = this.sink.begin(scope);
        let clone: Response | undefined;
        try {
          clone = response.clone();
          this.observe(clone, scope, id);
        } catch {
          this.unavailable(scope);
          if (clone?.body && !clone.body.locked) void clone.body.cancel().catch(() => {});
          try { this.sink.complete(scope, id, { kind: 'unknown', reason: 'unavailable' }); } catch {}
          this.stats.skipped++;
        }
      } catch { this.stats.skipped++; this.unavailable(scope); }
      return response;
    };
    host[OWNER] = this;
    globalThis.fetch = this.wrapper;
  }
  private unavailable(scope: CallScope): void {
    try { this.sink.unavailable?.(scope); } catch { /* Diagnostics cannot replace transport failures. */ }
  }
  private allowed(provider: string, url: string): boolean {
    let normalized: string;
    try { normalized = new URL(url).href; } catch { return false; }
    return this.config.targets.some(target => target.provider === provider && target.url === normalized);
  }
  private observe(response: Response, scope: CallScope, id: string): void {
    const reader = response.body!.getReader();
    const parser = new EffortParser(this.config.limits.maxEventBytes, this.config.limits.maxEffortChars);
    this.inFlight++;
    let settled = false;
    let cancelled = false;
    let wake: ((result: Observation) => void) | undefined;
    const interrupted = new Promise<Observation>(resolve => { wake = resolve; });
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      // Cancelling one tee branch can wait for the other. Never await it.
      void reader.cancel().catch(() => {});
    };
    const timer = setTimeout(() => { wake?.({ kind: 'unknown', reason: 'timeout' }); cancel(); }, this.config.limits.maxObserveMs);
    timer.unref();
    const run = async (): Promise<Observation> => {
      let total = 0;
      try {
        while (!cancelled) {
          const next = await reader.read();
          if (next.done) return parser.end();
          total += next.value.byteLength;
          if (total > this.config.limits.maxResponseBytes) return { kind: 'unknown', reason: 'byte-limit' };
          const result = parser.feed(next.value);
          if (result) return result;
        }
        return { kind: 'unknown', reason: 'interrupted' };
      } catch { return { kind: 'unknown', reason: 'read-error' }; }
    };
    const done = Promise.race([run(), interrupted]).then(result => {
      settled = true;
      clearTimeout(timer); cancel();
      if (this.active) {
        this.stats[result.kind]++;
        try { this.sink.complete(scope, id, result); } catch { /* Observer callbacks never escape into fetch. */ }
      }
    }).finally(() => { this.inFlight--; this.jobs.delete(job); });
    const job: ReaderJob = { done, cancel: () => { if (!settled) wake?.({ kind: 'unknown', reason: 'interrupted' }); cancel(); } };
    this.jobs.add(job);
    void done.catch(() => {});
  }
  async dispose(): Promise<void> {
    this.active = false;
    if (globalThis.fetch === this.wrapper && this.previous) globalThis.fetch = this.previous;
    const host = globalThis as FetchGlobal;
    if (host[OWNER] === this) delete host[OWNER];
    for (const job of this.jobs) job.cancel();
    await Promise.allSettled([...this.jobs].map(job => job.done));
  }
  async drained(): Promise<void> { await Promise.allSettled([...this.jobs].map(job => job.done)); }
  get pending(): number { return this.inFlight; }
}
