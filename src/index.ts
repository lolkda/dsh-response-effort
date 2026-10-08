import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { Config, settings } from './config.ts';
import type { InputSettings } from './config.ts';
import { record, text } from './contracts.ts';
import { Associations } from './host/association.ts';
import { EffortCache } from './host/cache.ts';
import { scopedStream } from './host/call-context.ts';
import { FetchTap } from './host/fetch-tap.ts';
import { EffortRemote } from './host/remote.ts';

export { Config };
export const name = 'response-effort';
export const inject = ['llm', 'sessions'];
/** Native event and LLM middleware integration; no durable event writes. */
export function apply(ctx: Context, input: InputSettings): void {
  const config = settings(input);
  const cache = new EffortCache(config.limits);
  const associations = new Associations(cache, config.limits);
  const tap = new FetchTap(config, associations);
  new EffortRemote(ctx, cache);
  ctx.provide('responseEffortDiagnostics', { stats: tap.stats, snapshot: (sessionId: string) => cache.snapshot(sessionId) });
  ctx.effect(() => {
    if (config.enabled) tap.install();
    const timer = setInterval(() => { cache.sweep(); associations.sweep(); }, Math.min(30_000, config.limits.pendingMs, config.limits.ttlMs));
    timer.unref();
    return async () => { clearInterval(timer); associations.clear(); cache.dispose(); await tap.dispose(); };
  }, 'response-effort: transport and memory');
  if (!config.enabled) return;
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    try {
      if (frame.type === 'start') associations.start(agent, String(agent.session.id), String(frame.attemptId));
      else if (frame.type === 'end') {
        if (frame.outcome.kind === 'committed' && frame.outcome.eventType === 'assistant/message') {
          const event = agent.session.eventAt(frame.outcome.seq);
          const message = record(record(event?.data)?.message);
          const source = record(message?.source);
          const response = record(record(source?.replayState)?.response);
          associations.end(agent, String(frame.attemptId), text(message?.id), text(response?.responseId));
        } else associations.end(agent, String(frame.attemptId));
      }
    } catch { /* Invalid identity is not grounds to fail a committed model message. */ }
  });
  ctx.on('agent/disposed', ({ agent }) => associations.abandonAgent(agent));
  ctx.on('llm/stream', (options: GenerateOptions, next) => scopedStream(next, () => {
    try { return associations.bind(options.sessionId === undefined ? undefined : String(options.sessionId), options.provider, options.model, isAgentLoopRequest(options)); }
    catch { return { sessionId: undefined, provider: options.provider, model: options.model, token: undefined }; }
  }));
}
