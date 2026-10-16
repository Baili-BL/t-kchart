import type { AgentMessage, AgentProvider, ToolCall, ToolRuntime } from './types';

/** runner 通过它把变化推给 UI（store），自己不依赖 React。 */
export interface MessageSink {
  append(msg: AgentMessage): void;
  patch(id: string, patch: Partial<AgentMessage>): void;
}

export interface RunOptions {
  provider: AgentProvider;
  /** 含刚发出的那条 user 消息 */
  history: AgentMessage[];
  tools: ToolRuntime;
  sink: MessageSink;
  signal?: AbortSignal;
  /** 防止模型无限调用工具 */
  maxSteps?: number;
}

let seq = 0;
export const newId = (p: string): string => p + '-' + Date.now().toString(36) + '-' + (seq++).toString(36);

/**
 * Agent 循环：
 *   provider 流式输出 → 若有工具调用则执行 → 把结果作为 role='tool' 消息再交给 provider → 直到没有新的调用。
 */
export async function runAgent(opts: RunOptions): Promise<void> {
  const { provider, tools, sink, signal } = opts;
  const maxSteps = opts.maxSteps ?? 6;
  const messages: AgentMessage[] = [...opts.history];

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return;

    const assistant: AgentMessage = { id: newId('msg'), role: 'assistant', content: '', createdAt: Date.now() };
    const request = { messages: [...messages], tools: tools.definitions, signal };
    messages.push(assistant);
    sink.append(assistant);

    const calls: ToolCall[] = [];
    let errored = false;

    for await (const ev of provider.send(request)) {
      if (signal?.aborted) break;
      if (ev.type === 'text-delta') {
        assistant.content += ev.text;
        sink.patch(assistant.id, { content: assistant.content });
      } else if (ev.type === 'tool-call') {
        calls.push(ev.call);
      } else if (ev.type === 'error') {
        errored = true;
        assistant.content += (assistant.content ? '\n\n' : '') + '⚠ ' + ev.message;
        assistant.isError = true;
        sink.patch(assistant.id, { content: assistant.content, isError: true });
        break;
      } else if (ev.type === 'done') {
        break;
      }
    }

    if (errored || signal?.aborted) return;
    if (calls.length === 0) return;

    assistant.toolCalls = calls;
    sink.patch(assistant.id, { toolCalls: calls });

    for (const call of calls) {
      let content: string;
      let isError = false;
      try {
        const r = await tools.execute(call);
        content = r.content;
        isError = !r.ok;
      } catch (e) {
        content = e instanceof Error ? e.message : String(e);
        isError = true;
      }
      const toolMsg: AgentMessage = {
        id: newId('msg'),
        role: 'tool',
        content,
        toolCallId: call.id,
        toolName: call.name,
        isError,
        createdAt: Date.now(),
      };
      messages.push(toolMsg);
      sink.append(toolMsg);
    }
  }

  const stop: AgentMessage = {
    id: newId('msg'),
    role: 'assistant',
    content: '⚠ 已达到单次对话的最大工具调用轮数（' + maxSteps + '），已停止。',
    isError: true,
    createdAt: Date.now(),
  };
  sink.append(stop);
}
