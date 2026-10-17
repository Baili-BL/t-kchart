/**
 * 警报 store + 触发引擎。
 *
 * 口径（诚实说明）：
 * - 触发判断是「条件由假变真」的瞬间：高于 = 前一价 < 值 且 当前价 ≥ 值，其余同理（见 evaluateAlert）。
 *   同一价位反复横跳会反复触发（trigger=每次 时）。
 * - 引擎只看得到**当前图表标的**的最新价（chartStore.lastPrice），所以只有挂在当前标的上的警报会被评估；
 *   其它标的的警报等切到对应图表才会动。真实行情接入（TODO 2.14）后换成全标的订阅。
 * - 通知渠道：App / 弹窗 → toast；声音 → WebAudio 短提示音（无音频资源）。过期 / 触发状态见 state。
 */
import { create } from 'zustand';
import { useChartStore } from './chartStore';
import { useToast } from '../ui/toast';
import { formatPrice } from '../data/quote';

export type AlertOp = 'crossing' | 'crossUp' | 'crossDown' | 'above' | 'below';

export const OP_LABELS: Record<AlertOp, string> = {
  crossing: '穿过',
  crossUp: '上穿',
  crossDown: '下穿',
  above: '高于',
  below: '低于',
};

export type NotifyChannel = 'app' | 'popup' | 'sound';
export const NOTIFY_LABELS: Record<NotifyChannel, string> = { app: 'App', popup: '弹窗', sound: '声音' };

export type AlertState = 'active' | 'triggered' | 'paused' | 'expired';
export const ALERT_STATE_LABELS: Record<AlertState, string> = {
  active: '等待中',
  triggered: '已触发',
  paused: '已暂停',
  expired: '已过期',
};

export interface AlertItem {
  id: string;
  ticker: string;
  op: AlertOp;
  /** 阈值 */
  value: number;
  /** 仅一次 / 每次 */
  trigger: 'once' | 'every';
  /** 到期时刻（epoch ms）；null = 不设置 */
  expires: number | null;
  message: string;
  notify: NotifyChannel[];
  state: AlertState;
  triggeredAt: number | null;
  createdAt: number;
}

export interface AlertLog {
  id: string;
  ticker: string;
  text: string;
  at: number;
}

/** 条件判定：条件由假变真才触发。未知 op 抛错。 */
export function evaluateAlert(op: AlertOp, value: number, prev: number, price: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(prev) || !Number.isFinite(price)) return false;
  switch (op) {
    case 'crossUp':
      return prev <= value && price > value;
    case 'crossDown':
      return prev >= value && price < value;
    case 'crossing':
      return (prev <= value && price > value) || (prev >= value && price < value);
    case 'above':
      return prev < value && price >= value;
    case 'below':
      return prev > value && price <= value;
    default:
      throw new Error('未知警报条件: ' + String(op));
  }
}

/** 警报消息（创建时生成并保存，之后不随格式化规则变化） */
export function alertMessage(ticker: string, op: AlertOp, value: number): string {
  return `${ticker}，价格 ${OP_LABELS[op]} ${formatPrice(value)}`;
}

/** 「周一 2025-06-16 09:54:10」 */
export function formatAlertTime(ts: number): string {
  const d = new Date(ts);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${week} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------- 持久化

const STORAGE_KEY = 't-kchart.alerts.v1';

export interface AlertDraft {
  ticker: string;
  op: AlertOp;
  value: number;
  trigger: 'once' | 'every';
  expires: number | null;
  notify: NotifyChannel[];
}

export function serializeAlerts(alerts: AlertItem[], logs: AlertLog[]): string {
  return JSON.stringify({ v: 1, alerts, logs });
}

export function hydrateAlerts(raw: string | null): { alerts: AlertItem[]; logs: AlertLog[] } {
  const empty = { alerts: [], logs: [] };
  if (!raw) return empty;
  try {
    const data = JSON.parse(raw) as { v?: unknown; alerts?: unknown; logs?: unknown };
    if (data.v !== 1 || !Array.isArray(data.alerts) || !Array.isArray(data.logs)) return empty;
    const alerts: AlertItem[] = [];
    for (const a of data.alerts) {
      if (typeof a !== 'object' || a === null) return empty;
      const it = a as Record<string, unknown>;
      if (typeof it.id !== 'string' || typeof it.ticker !== 'string' || typeof it.value !== 'number') return empty;
      alerts.push({
        id: it.id,
        ticker: it.ticker,
        op: (it.op as AlertOp) ?? 'crossing',
        value: it.value,
        trigger: it.trigger === 'every' ? 'every' : 'once',
        expires: typeof it.expires === 'number' ? it.expires : null,
        message: typeof it.message === 'string' ? it.message : alertMessage(it.ticker, (it.op as AlertOp) ?? 'crossing', it.value),
        notify: Array.isArray(it.notify) ? (it.notify as NotifyChannel[]) : ['app'],
        state: (it.state as AlertState) ?? 'active',
        triggeredAt: typeof it.triggeredAt === 'number' ? it.triggeredAt : null,
        createdAt: typeof it.createdAt === 'number' ? it.createdAt : Date.now(),
      });
    }
    const logs = (data.logs as AlertLog[]).filter((l) => l && typeof l === 'object' && typeof (l as AlertLog).text === 'string');
    return { alerts, logs };
  } catch {
    return empty;
  }
}

function persist(alerts: AlertItem[], logs: AlertLog[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, serializeAlerts(alerts, logs));
  } catch {
    // 写不进去就算了
  }
}

// ---------------------------------------------------------------- 提示音（无音频资源，WebAudio 合成短音）

function beep(): void {
  try {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return;
    const ctx = new window.AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = (): void => void ctx.close();
  } catch {
    // 自动播放策略等导致失败就静默
  }
}

// ---------------------------------------------------------------- store

interface AlertStoreState {
  alerts: AlertItem[];
  logs: AlertLog[];

  addAlert: (draft: AlertDraft) => AlertItem;
  removeAlert: (id: string) => void;
  togglePause: (id: string) => void;
  clearLogs: () => void;
  /** 喂一个最新价：内部记录前值，条件由假变真时触发。返回本次触发的警报 */
  processTick: (ticker: string, price: number, now?: number) => AlertItem[];
}

let idSeq = 0;
const newId = (): string => `al-${Date.now().toString(36)}-${++idSeq}`;

const boot = (() => {
  try {
    if (typeof localStorage === 'undefined') return { alerts: [], logs: [] };
    return hydrateAlerts(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { alerts: [], logs: [] };
  }
})();

/** 各标的上一个已知价（触发判定要用前值；跨会话从第一个 tick 起） */
const prevPrices = new Map<string, number>();

export const useAlertStore = create<AlertStoreState>((set, get) => ({
  alerts: boot.alerts,
  logs: boot.logs,

  addAlert: (draft) => {
    const now = Date.now();
    const item: AlertItem = {
      id: newId(),
      ticker: draft.ticker,
      op: draft.op,
      value: draft.value,
      trigger: draft.trigger,
      expires: draft.expires,
      message: alertMessage(draft.ticker, draft.op, draft.value),
      notify: draft.notify.length > 0 ? draft.notify : ['app'],
      state: 'active',
      triggeredAt: null,
      createdAt: now,
    };
    set((s) => {
      const alerts = [...s.alerts, item];
      persist(alerts, s.logs);
      return { alerts };
    });
    return item;
  },

  removeAlert: (id) =>
    set((s) => {
      const alerts = s.alerts.filter((a) => a.id !== id);
      persist(alerts, s.logs);
      return { alerts };
    }),

  togglePause: (id) =>
    set((s) => {
      const alerts = s.alerts.map((a) =>
        a.id === id && (a.state === 'active' || a.state === 'paused')
          ? { ...a, state: a.state === 'active' ? ('paused' as const) : ('active' as const) }
          : a,
      );
      persist(alerts, s.logs);
      return { alerts };
    }),

  clearLogs: () =>
    set((s) => {
      persist(s.alerts, []);
      return { logs: [] };
    }),

  processTick: (ticker, price, now = Date.now()) => {
    const prev = prevPrices.get(ticker);
    prevPrices.set(ticker, price);
    const hasPrev = prev != null && Number.isFinite(prev) && Number.isFinite(price);
    const fired: AlertItem[] = [];
    set((s) => {
      const logs = [...s.logs];
      let changed = false;
      const alerts = s.alerts.map((a) => {
        if (a.ticker !== ticker || a.state !== 'active') return a;
        // 过期先于触发判断（基线 tick 也要能标记过期）
        if (a.expires != null && now >= a.expires) {
          changed = true;
          return { ...a, state: 'expired' as const };
        }
        if (!hasPrev || !evaluateAlert(a.op, a.value, prev as number, price)) return a;
        fired.push(a);
        changed = true;
        logs.unshift({ id: newId(), ticker: a.ticker, text: `${a.message} @ ${formatPrice(price)}`, at: now });
        if (a.trigger === 'once') return { ...a, state: 'triggered' as const, triggeredAt: now };
        return { ...a, triggeredAt: now };
      });
      if (!changed) return s;
      const trimmedLogs = logs.slice(0, 200);
      persist(alerts, trimmedLogs);
      return { alerts, logs: trimmedLogs };
    });
    // 通知副作用放在 set 外，避免渲染期弹
    for (const a of fired) {
      if (a.notify.includes('app') || a.notify.includes('popup')) {
        useToast.getState().show(`警报触发：${a.message}（${formatPrice(price)}）`);
      }
      if (a.notify.includes('sound')) beep();
    }
    return fired;
  },
}));

/** 测试用：清空内部价格轨迹 */
export function resetPriceFeed(): void {
  prevPrices.clear();
}

let wired = false;

/** 把 chartStore 的最新价接到触发引擎上（应用入口调用一次；重复调用无副作用） */
export function wireAlertEngine(): void {
  if (wired) return;
  wired = true;
  useChartStore.subscribe((s) => {
    if (s.lastPrice == null) return;
    useAlertStore.getState().processTick(s.symbol, s.lastPrice);
  });
}
