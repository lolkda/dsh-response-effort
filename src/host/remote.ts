import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol';
import type { Snapshot } from '../contracts.ts';
import { EffortCache } from './cache.ts';

export class EffortRemote {
  readonly typertRemote = bindTypertRemote(this, 'responseEffort');
  constructor(readonly ctx: Context, private readonly cache: EffortCache) { ctx.provide('responseEffort', this); }
  @Remote({ mode: 'stream' })
  watch(session: Session, signal: AbortSignal): AsyncIterable<Snapshot> {
    return this.cache.watch(String(session.id), signal);
  }
}
