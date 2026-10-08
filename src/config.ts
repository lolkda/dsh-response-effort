import z from '@deepseek-ai/schemastery';
import { DEFAULT_LIMITS } from './contracts.ts';
import type { Limits, Settings, Target } from './contracts.ts';

const limitShape = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, value]) => [key, z.number().min(1).default(value)]));
export const Config = z.object({
  enabled: z.boolean().default(false).description('Observe matching Responses SSE; changing this config reloads only this plugin.'),
  targets: z.array(z.object({ provider: z.string().required(), url: z.string().required() })).default([]),
  limits: z.object(limitShape).default({ ...DEFAULT_LIMITS }),
});
export interface InputSettings { enabled?: boolean; targets?: readonly Target[]; limits?: Partial<Limits> }
export function endpoint(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/responses')) throw new Error('A target must be an exact HTTP(S) Responses URL without credentials, query or fragment');
  return url.href;
}
export function settings(input: InputSettings): Settings {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive safe integer`);
  if (limits.maxObserveMs > 2_147_483_647) throw new Error('maxObserveMs exceeds the Node timer range');
  if (limits.maxEffortChars > 4096 || limits.maxSessionEntries > 10000) throw new Error('Configured limits exceed the Remote snapshot contract');
  const targets = (input.targets ?? []).map(target => {
    if (!target.provider.trim() || target.provider.length > 256) throw new Error('A target requires a non-empty provider id of at most 256 characters');
    return Object.freeze({ provider: target.provider, url: endpoint(target.url) });
  });
  return Object.freeze({ enabled: input.enabled ?? false, targets: Object.freeze(targets), limits: Object.freeze(limits) });
}
