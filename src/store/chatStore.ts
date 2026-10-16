import { create } from 'zustand';
import type { AgentMessage } from '../agent/types';
import { newId, runAgent } from '../agent/runner';
import { resolveProvider } from '../agent/registry';
import { createChartTools } from '../agent/tools';
import { chartControls } from '../workspace/chartControls';

export interface Conversation {
  id: string;
  title: string;
  messages: AgentMessage[];
  updatedAt: number;
}

interface ChatState {
  conversations: Conversation[];
  /** null = 欢迎页（还没开始新对话） */
  activeId: string | null;
  modelId: string;
  teachMode: boolean;
  sending: boolean;

  newChat: () => void;
  selectChat: (id: string) => void;
  setModel: (id: string) => void;
  setTeachMode: (on: boolean) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
}

function seed(title: string, user: string, reply: string): Conversation {
  const now = Date.now();
  return {
    id: newId('chat'),
    title,
    updatedAt: now,
    messages: [
      { id: newId('msg'), role: 'user', content: user, createdAt: now - 1000 },
      { id: newId('msg'), role: 'assistant', content: reply, createdAt: now },
    ],
  };
}

const SEEDS: Conversation[] = [
  seed(
    'Backtest 20/50 EMA crossover with …',
    'Backtest 20/50 EMA crossover on TSLA',
    '回测需要 Pine 撮合（strategy.*），这是 TODO 里的 P0。目前可以先用 run_pine 画出两条 EMA。',
  ),
  seed(
    'Label market structure: higher highs, …',
    'Label market structure: higher highs, higher lows',
    '结构标注属于绘图工具扩充（TODO 2.8），框架已就绪。',
  ),
];

let abort: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: SEEDS,
  activeId: null,
  modelId: 'auto',
  teachMode: false,
  sending: false,

  newChat: () => {
    abort?.abort();
    set({ activeId: null, sending: false });
  },
  selectChat: (id) => {
    abort?.abort();
    set({ activeId: id, sending: false });
  },
  setModel: (modelId) => set({ modelId }),
  setTeachMode: (teachMode) => set({ teachMode }),

  stop: () => {
    abort?.abort();
    set({ sending: false });
  },

  send: async (raw) => {
    const text = raw.trim();
    if (!text || get().sending) return;

    // 没有活动对话 → 新建一个，标题取首句
    let id = get().activeId;
    const userMsg: AgentMessage = { id: newId('msg'), role: 'user', content: text, createdAt: Date.now() };
    if (!id) {
      id = newId('chat');
      const title = text.length > 36 ? text.slice(0, 36) + '…' : text;
      set((s) => ({
        activeId: id,
        conversations: [{ id: id as string, title, messages: [], updatedAt: Date.now() }, ...s.conversations],
      }));
    }
    const convId = id;

    const mutate = (fn: (c: Conversation) => Conversation): void =>
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? fn(c) : c)) }));

    mutate((c) => ({ ...c, messages: [...c.messages, userMsg], updatedAt: Date.now() }));
    const history = get().conversations.find((c) => c.id === convId)?.messages ?? [userMsg];

    abort = new AbortController();
    const signal = abort.signal;
    set({ sending: true });
    try {
      await runAgent({
        provider: resolveProvider(get().modelId),
        history,
        tools: createChartTools(chartControls),
        signal,
        sink: {
          append: (m) => mutate((c) => ({ ...c, messages: [...c.messages, m], updatedAt: Date.now() })),
          patch: (mid, p) =>
            mutate((c) => ({ ...c, messages: c.messages.map((m) => (m.id === mid ? { ...m, ...p } : m)) })),
        },
      });
    } finally {
      if (abort?.signal === signal) set({ sending: false });
    }
  },
}));
