export type Terminal = 'completed' | 'incomplete' | 'failed';
export type UnknownReason = 'invalid-event' | 'invalid-effort' | 'event-limit' | 'byte-limit' | 'timeout' | 'interrupted' | 'stream-ended' | 'read-error' | 'ambiguous' | 'unavailable';
export type Observation =
  | { readonly kind: 'observed'; readonly effort: string; readonly terminal: Terminal; readonly responseId?: string }
  | { readonly kind: 'absent'; readonly terminal: Terminal; readonly responseId?: string }
  | { readonly kind: 'unknown'; readonly reason: UnknownReason };

export interface Target { readonly provider: string; readonly url: string }
export interface Limits {
  readonly maxConcurrent: number;
  readonly maxResponseBytes: number;
  readonly maxEventBytes: number;
  readonly maxObserveMs: number;
  readonly maxEffortChars: number;
  readonly pendingMs: number;
  readonly maxEntries: number;
  readonly maxSessionEntries: number;
  readonly ttlMs: number;
}
export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxConcurrent: 8, maxResponseBytes: 16 * 1024 * 1024, maxEventBytes: 1024 * 1024,
  maxObserveMs: 10 * 60_000, maxEffortChars: 256, pendingMs: 2 * 60_000,
  maxEntries: 2000, maxSessionEntries: 200, ttlMs: 6 * 60 * 60_000,
});
export interface Settings { readonly enabled: boolean; readonly targets: readonly Target[]; readonly limits: Limits }
export interface EffortItem {
  readonly messageId: string;
  readonly provider: string;
  readonly model: string;
  readonly observedAt: number;
  readonly result: Observation;
}
export interface ResponseItem {
  readonly captureId: string;
  readonly sequence: number;
  readonly provider: string;
  readonly model: string;
  readonly observedAt: number;
  readonly result: Observation;
}
export interface Snapshot {
  readonly generation: string;
  readonly revision: number;
  readonly items: readonly EffortItem[];
  readonly responses: readonly ResponseItem[];
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
