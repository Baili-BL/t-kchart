import type { AgentEvent, AgentProvider, AgentRequest } from '../types';

/**
 * DeepSeek harness 适配点（空壳）。
 *
 * 接入时在 `send()` 里完成三件事：
 *   1. 把 `req.messages` / `req.tools` 转成 harness 要的请求格式；
 *   2. 以流式方式调用 harness（SSE / WebSocket / fetch stream 均可）；
 *   3. 把响应逐段翻译成 `AgentEvent`：
 *        文本增量  → { type: 'text-delta', text }
 *        工具调用  → { type: 'tool-call', call }   （arguments 必须是已解析的对象）
 *        结束      → { type: 'done' }
 *        失败      → { type: 'error', message }
 *
 * 上层的循环（runner.ts）会负责执行工具并把结果作为 role='tool' 的消息再次交给 provider。
 * UI 与图表工具都不需要改。
 */
export interface DeepSeekConfig {
  /** harness 服务地址，例如 http://127.0.0.1:8787 */
  baseUrl: string;
  apiKey?: string;
  /** 例如 deepseek-chat / deepseek-reasoner */
  model: string;
}

export function readDeepSeekConfig(): DeepSeekConfig {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    baseUrl: env.VITE_DEEPSEEK_BASE_URL ?? '',
    apiKey: env.VITE_DEEPSEEK_API_KEY,
    model: env.VITE_DEEPSEEK_MODEL ?? 'deepseek-chat',
  };
}

export function createDeepSeekProvider(config: DeepSeekConfig): AgentProvider {
  return {
    id: 'deepseek',
    label: 'DeepSeek（harness）',
    // eslint-disable-next-line require-yield
    async *send(_req: AgentRequest): AsyncGenerator<AgentEvent> {
      if (!config.baseUrl) {
        yield {
          type: 'error',
          message: 'DeepSeek harness 尚未接入：请在 .env 里设置 VITE_DEEPSEEK_BASE_URL，并在 providers/deepseek.ts 实现 send()。',
        };
        return;
      }
      yield {
        type: 'error',
        message: 'providers/deepseek.ts 的 send() 还没有实现（baseUrl=' + config.baseUrl + '）。',
      };
    },
  };
}
