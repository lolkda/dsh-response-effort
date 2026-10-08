import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { LlmAdapter, ReasoningEffortId, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-responses';
import type { Model } from '@earendil-works/pi-ai';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import * as plugin from '../src/index.ts';
import type { Snapshot } from '../src/contracts.ts';
import { URL, wire } from './fixtures.ts';
import { calls } from '../src/host/call-context.ts';

const model: Model<'openai-responses'> = { id: 'fixture-model', name: 'Fixture', api: 'openai-responses', provider: 'fixture', baseUrl: 'https://fixture.test/v1', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 };
class SdkAdapter extends LlmAdapter {
  prepared = 0;
  async resolveModel(provider: string, id: string) { return { provider, id, name: id, reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } }; }
  async prepareCall(provider: string, id: string) { this.prepared++; return super.prepareCall(provider, id); }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const result = await streamSimple(model, normalizeContext({ messages: [{ role: 'user', content: 'fixture', timestamp: 0 }] }), { apiKey: 'fixture-key', reasoning: 'high', ...(options.signal ? { signal: options.signal } : {}) }).result();
    assert.equal('providerThinkingLevel' in result, false, 'SDK does not preserve response effort');
    if (result.stopReason === 'error') { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: result.errorMessage ?? 'fixture error' } } }; return; }
    for (const [index, block] of result.content.entries()) {
      if (block.type === 'text') {
        yield { type: 'block-start', index, blockType: 'text' };
        yield { type: 'text-delta', index, text: block.text };
        yield { type: 'block-end', index, block: { type: 'text', text: block.text } };
      } else if (block.type === 'toolCall') {
        yield { type: 'block-start', index, blockType: 'tool-call' };
        yield { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(block.id), name: block.name, arguments: JSON.stringify(block.arguments) } };
      }
    }
    yield { type: 'finish', reason: { kind: result.stopReason === 'toolUse' ? 'tool-calls' : 'stop' }, replayState: { response: { responseId: result.responseId } } };
  }
}

test('real SDK + production prepared AgentLoop maps reported max to exact message id', { timeout: 10000 }, async () => {
  const original = globalThis.fetch;
  const requests: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(wire('max', ''), { headers: { 'content-type': 'text/event-stream' } });
  };
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    const adapter = new SdkAdapter();
    ctx.llm.registerAdapter(['fixture'], adapter);
    await ctx.plugin(plugin, { enabled: true, targets: [{ provider: 'fixture', url: URL }] });
    const harness = await mountAgentLoopTestHarness(ctx);
    const agent = await harness.create(SessionId('effort-integration'), { provider: 'fixture', model: 'fixture-model', reasoningEffort: ReasoningEffortId('high') });
    const diagnostics = ctx.get('responseEffortDiagnostics') as { snapshot(id: string): Snapshot };
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }));
    await agent.whenIdle();
    const message = agent.session.ownEvents().find(event => event.type === 'assistant/message');
    assert.ok(message?.type === 'assistant/message', JSON.stringify(agent.session.ownEvents().map(event => ({ type: event.type, data: event.type === 'turn/end' ? event.data : undefined }))));
    // Drain event-loop callbacks without timing-based polling.
    await new Promise<void>(resolve => setImmediate(resolve));
    const snapshot = diagnostics.snapshot(String(agent.session.id));
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0]?.messageId, message.data.message.id);
    assert.equal(snapshot.items[0]?.result.kind, 'observed');
    assert.equal(snapshot.items[0]?.result.kind === 'observed' && snapshot.items[0].result.effort, 'max');
    assert.ok(adapter.prepared > 0);
    assert.equal((requests[0] as { reasoning: { effort: string } }).reasoning.effort, 'high');
    assert.ok(!JSON.stringify(message.data).includes('"effort":"max"'), 'observation is not written into durable event');
  } finally { try { await ctx.fiber.dispose(); } finally { globalThis.fetch = original; } }
});

function toolWire(): string {
  const item = { type: 'function_call', id: 'fc-fixture', call_id: 'call-fixture', name: 'fixture_tool', arguments: '{}' };
  return [
    { type: 'response.created', response: { id: 'tool-response' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{}' },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'tool-response', status: 'completed', reasoning: { effort: 'medium' }, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}

test('production concurrent Agents, failed retry and tool continuation retain distinct efforts', { timeout: 10000 }, async () => {
  const original = globalThis.fetch;
  const counts = new Map<string, number>();
  globalThis.fetch = async () => {
    const sessionId = calls.getStore()?.sessionId; assert.ok(sessionId);
    const count = (counts.get(sessionId) ?? 0) + 1; counts.set(sessionId, count);
    await Promise.resolve();
    let body: string;
    if (sessionId === 'retry' && count === 1) body = `data: ${JSON.stringify({ type: 'response.failed', response: { id: 'failed', status: 'failed', reasoning: { effort: 'failed-value' }, error: { code: 'SERVER', message: 'fixture failure' } } })}\n\n`;
    else if (sessionId === 'tool' && count === 1) body = toolWire();
    else body = wire(sessionId === 'tool' ? 'low' : sessionId === 'left' ? 'high' : sessionId === 'right' ? 'xhigh' : 'max', '');
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    ctx.llm.registerAdapter(['fixture'], new SdkAdapter());
    ctx.tools.register({ name: 'fixture_tool', description: 'fixture', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'done' }] }, execute: async () => 'done' });
    ctx.on('agent/request-error', async ({ agent }, next) => agent.session.id === 'retry' && counts.get('retry') === 1 ? { kind: 'retry' as const } : next());
    await ctx.plugin(plugin, { enabled: true, targets: [{ provider: 'fixture', url: URL }] });
    const harness = await mountAgentLoopTestHarness(ctx);
    const agents = await Promise.all(['left', 'right', 'retry', 'tool'].map(id => harness.create(SessionId(id), { provider: 'fixture', model: 'fixture-model', reasoningEffort: ReasoningEffortId('high') })));
    for (const agent of agents) agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fixture' }], source: { kind: 'user' } }));
    await Promise.all(agents.map(agent => agent.whenIdle()));
    await new Promise<void>(resolve => setImmediate(resolve));
    const diagnostics = ctx.get('responseEffortDiagnostics') as { snapshot(id: string): Snapshot };
    for (const [index, agent] of agents.entries()) {
      const messages = agent.session.ownEvents().filter(event => event.type === 'assistant/message');
      const closing = messages.at(-1); assert.ok(closing?.type === 'assistant/message');
      const snapshot = diagnostics.snapshot(String(agent.session.id));
      const result = snapshot.items.find(item => item.messageId === closing.data.message.id)?.result;
      assert.ok(result?.kind === 'observed', String(agent.session.id));
      assert.equal(result.effort, ['high', 'xhigh', 'max', 'low'][index]);
      assert.ok(!JSON.stringify(snapshot.items).includes('failed-value'), 'failed response is never assigned to a successful message');
      const reported = snapshot.responses.map(item => item.result.kind === 'observed' ? item.result.effort : item.result.kind);
      if (agent.session.id === 'tool') {
        assert.equal(messages.length, 2); assert.equal(counts.get('tool'), 2); assert.equal(snapshot.items.length, 2);
        assert.deepEqual(reported, ['medium', 'low']);
      } else if (agent.session.id === 'retry') {
        assert.equal(counts.get('retry'), 2); assert.equal(snapshot.items.length, 1);
        assert.deepEqual(reported, ['failed-value', 'max']);
      } else assert.deepEqual(reported, [result.effort]);
    }
  } finally { try { await ctx.fiber.dispose(); } finally { globalThis.fetch = original; } }
});
