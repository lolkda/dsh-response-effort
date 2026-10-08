export function wire(effort: unknown = 'max', id = 'resp-fixture', content = 'fixture reply'): string {
  const item = { id: 'msg-fixture', type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer', content: [{ type: 'output_text', text: content, annotations: [] }] };
  const events = [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [], status: 'in_progress' } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: content },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id, status: 'completed', model: 'fixture-model', reasoning: { effort, summary: 'auto' }, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
}
export const URL = 'https://fixture.test/v1/responses';
