import type { RemoteStreamItem, RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import type { EffortItem, ResponseItem, Snapshot } from '../contracts.ts';
import { decodeSnapshot } from '../remote-contract.ts';

export interface RemoteReader<Item> extends AsyncIterable<RemoteStreamItem<Item>> { dispose(): Promise<void> }
export interface EffortTransport {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  $stream<Item>(options: RemoteStreamOptions<Item>): RemoteReader<Item>;
  responseEffort: { watch(sessionId: string, signal?: AbortSignal): AsyncIterable<Snapshot> };
}
export interface Source<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
export type EffortSource = Source<ReadonlyMap<string, EffortItem>>;
export interface ResponseFeed {
  readonly status: 'connecting' | 'ready' | 'unavailable';
  readonly generation?: string;
  readonly items: readonly ResponseItem[];
}
export type ResponseSource = Source<ResponseFeed>;
const EMPTY: ReadonlyMap<string, EffortItem> = new Map();
const CONNECTING: ResponseFeed = Object.freeze({ status: 'connecting', items: Object.freeze([]) });
const UNAVAILABLE: ResponseFeed = Object.freeze({ status: 'unavailable', items: Object.freeze([]) });
interface LiveSession {
  items: ReadonlyMap<string, EffortItem>;
  responses: ResponseFeed;
  generation: string | undefined;
  revision: number;
  readonly listeners: Set<() => void>;
  stream?: RemoteReader<Snapshot>;
}
/** Badge and response dock share one native stream per actively rendered Session. */
export class EffortHub {
  private live = new Map<string, LiveSession>();
  private disposed = false;
  constructor(private readonly remote: EffortTransport) {}
  source(sessionId: string): EffortSource {
    return { getSnapshot: () => this.live.get(sessionId)?.items ?? EMPTY, subscribe: listener => this.subscribe(sessionId, listener) };
  }
  responseSource(sessionId: string): ResponseSource {
    return { getSnapshot: () => this.live.get(sessionId)?.responses ?? (this.disposed ? UNAVAILABLE : CONNECTING), subscribe: listener => this.subscribe(sessionId, listener) };
  }
  private subscribe(sessionId: string, listener: () => void): () => void {
    if (this.disposed) return () => {};
    let state = this.live.get(sessionId);
    const first = state === undefined;
    if (!state) { state = { items: EMPTY, responses: CONNECTING, generation: undefined, revision: -1, listeners: new Set() }; this.live.set(sessionId, state); }
    const notify = () => listener();
    state.listeners.add(notify);
    if (first) this.open(sessionId, state);
    const owned = state;
    return () => {
      owned.listeners.delete(notify);
      if (owned.listeners.size === 0 && this.live.get(sessionId) === owned) {
        this.live.delete(sessionId);
        void owned.stream?.dispose().catch(() => {});
      }
    };
  }
  private open(sessionId: string, state: LiveSession): void {
    const reset = () => {
      state.items = EMPTY; state.responses = UNAVAILABLE; state.generation = undefined; state.revision = -1;
      for (const notify of state.listeners) notify();
    };
    let stream: RemoteReader<Snapshot>;
    try {
      stream = this.remote.$stream<Snapshot>({
        name: 'response-effort', open: signal => this.remote.responseEffort.watch(sessionId, signal),
        ended: () => new Error('response-effort observation stream ended'), carrierFailed: reset,
      });
    } catch { reset(); return; }
    state.stream = stream;
    const consume = async () => {
      try {
        for await (const frame of stream) {
          if (this.disposed || this.live.get(sessionId) !== state) return;
          const snapshot = decodeSnapshot(frame.value);
          if (snapshot.generation !== state.generation || snapshot.revision >= state.revision) {
            state.generation = snapshot.generation; state.revision = snapshot.revision;
            state.items = new Map(snapshot.items.map(item => [item.messageId, item]));
            state.responses = { status: 'ready', generation: snapshot.generation, items: [...snapshot.responses].sort((a, b) => b.sequence - a.sequence) };
            for (const notify of state.listeners) notify();
          }
          frame.accept();
        }
      } catch { if (this.live.get(sessionId) === state) reset(); }
      finally {
        if (this.live.get(sessionId) === state) reset();
        await stream.dispose().catch(() => {});
      }
    };
    void consume();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    const states = [...this.live.values()];
    this.live.clear();
    for (const state of states) for (const notify of state.listeners) notify();
    await Promise.allSettled(states.map(state => state.stream?.dispose()));
  }
  get activeSessions(): number { return this.live.size; }
}
