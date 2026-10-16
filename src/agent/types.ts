/**
 * Agent 抽象层。
 *
 * 目标：UI 只认这里的类型，不认具体模型。后续接 DeepSeek harness 时，
 * 只需要实现一个 `AgentProvider`，UI 与图表工具一行都不用改。
 */

export type Role = 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  role: Role;
  content: string;
  /** assistant 消息发起的工具调用 */
  toolCalls?: ToolCall[];
  /** role === 'tool' 时，对应哪次调用 */
  toolCallId?: string;
  /** role === 'tool' 时的工具名，仅用于展示 */
  toolName?: string;
  /** 工具执行是否出错 */
  isError?: boolean;
  createdAt: number;
}

/** JSON Schema 的最小子集，足够描述图表工具的参数 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string; enum?: string[] }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolResult {
  ok: boolean;
  /** 给模型看的结果文本 */
  content: string;
}

/** 工具运行时：定义（给模型）+ 执行（给 runner） */
export interface ToolRuntime {
  definitions: ToolDefinition[];
  execute(call: ToolCall): Promise<ToolResult>;
}

/** provider 流出的事件 */
export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AgentRequest {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  send(req: AgentRequest): AsyncIterable<AgentEvent>;
}

/** 面板里让用户选的「模型」条目 */
export interface ModelOption {
  id: string;
  label: string;
  providerId: string;
}
