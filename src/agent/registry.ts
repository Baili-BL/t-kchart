import type { AgentProvider, ModelOption } from './types';
import { createMockProvider } from './providers/mock';
import { createDeepSeekProvider, readDeepSeekConfig } from './providers/deepseek';

/** 面板「Auto」下拉里的选项 */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'auto', label: 'Auto', providerId: 'auto' },
  { id: 'mock', label: 'Mock（本地演示）', providerId: 'mock' },
  { id: 'deepseek-chat', label: 'DeepSeek V3', providerId: 'deepseek' },
  { id: 'deepseek-reasoner', label: 'DeepSeek R1', providerId: 'deepseek' },
];

/**
 * Auto 的选择策略：配置了 harness 地址就用 DeepSeek，否则回落到 mock。
 */
export function resolveProvider(modelId: string): AgentProvider {
  const cfg = readDeepSeekConfig();
  const opt = MODEL_OPTIONS.find((m) => m.id === modelId) ?? MODEL_OPTIONS[0];
  if (opt.providerId === 'deepseek') {
    return createDeepSeekProvider({ ...cfg, model: opt.id });
  }
  if (opt.providerId === 'mock') return createMockProvider();
  // auto
  return cfg.baseUrl ? createDeepSeekProvider(cfg) : createMockProvider();
}
