/**
 * 自选表 store：多分组（设计稿里的 INDICES / Stocks / DIY）+ 每组一份标的序列。
 *
 * 设计约束：
 * - 只收 `SYMBOL_BY_TICKER` 里存在的 ticker（hydrate 时过滤、addSymbol 时拒绝），未知代码不静默入库
 * - 序列即顺序：右键菜单的上移 / 下移直接改数组
 * - 持久化到 localStorage（key 见下）；node 环境（vitest）与隐私模式下读写失败不影响功能
 */
import { create } from 'zustand';
import { SYMBOL_BY_TICKER } from '../data/symbols';

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

const STORAGE_KEY = 't-kchart.watchlists.v1';

/** 出厂默认分组（首次启动 / 存档损坏时使用） */
export function defaultWatchlists(): Watchlist[] {
  return [
    { id: 'indices', name: 'INDICES', symbols: ['SHCOMP', 'SZCOMP', 'HSI', 'SPX', 'NDX', 'DJI', 'N225'] },
    { id: 'stocks', name: 'Stocks', symbols: ['600519', '000001', '0700', '9988', 'TSLA', 'AAPL', 'NVDA', 'AMD'] },
    { id: 'diy', name: 'DIY', symbols: ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'SPY'] },
  ];
}

export function serializeWatchlists(lists: Watchlist[], activeId: string): string {
  return JSON.stringify({ v: 1, activeId, lists });
}

/** 存档 → 状态。任何结构问题 / 未知 ticker（过滤后整组为空也算）都返回 null，调用方回默认值。 */
export function hydrateWatchlists(raw: string | null): { lists: Watchlist[]; activeId: string } | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { v?: unknown; activeId?: unknown; lists?: unknown };
    if (data.v !== 1 || !Array.isArray(data.lists)) return null;
    const lists: Watchlist[] = [];
    for (const item of data.lists) {
      if (typeof item !== 'object' || item === null) return null;
      const { id, name, symbols } = item as Record<string, unknown>;
      if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(symbols)) return null;
      const known = symbols.filter((t): t is string => typeof t === 'string' && SYMBOL_BY_TICKER.has(t));
      lists.push({ id, name, symbols: known });
    }
    if (lists.length === 0) return null;
    const activeId =
      typeof data.activeId === 'string' && lists.some((l) => l.id === data.activeId) ? data.activeId : lists[0].id;
    return { lists, activeId };
  } catch {
    return null;
  }
}

function load(): { lists: Watchlist[]; activeId: string } {
  try {
    if (typeof localStorage === 'undefined') return { lists: defaultWatchlists(), activeId: defaultWatchlists()[0].id };
    return hydrateWatchlists(localStorage.getItem(STORAGE_KEY)) ?? { lists: defaultWatchlists(), activeId: defaultWatchlists()[0].id };
  } catch {
    return { lists: defaultWatchlists(), activeId: defaultWatchlists()[0].id };
  }
}

function persist(lists: Watchlist[], activeId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, serializeWatchlists(lists, activeId));
  } catch {
    // 写不进去（隐私模式 / 配额）就算了，会话内照常工作
  }
}

interface WatchlistState {
  lists: Watchlist[];
  activeId: string;

  selectList: (id: string) => void;
  /** 新建分组并选中，返回新 id */
  addList: (name: string) => string;
  /** 删分组；只剩一组时不可删（返回 false） */
  removeList: (id: string) => boolean;
  renameList: (id: string, name: string) => void;
  /** 加到分组（默认当前组）。未知标的 / 重复 → false，不改动 */
  addSymbol: (ticker: string, listId?: string) => boolean;
  removeSymbol: (ticker: string, listId?: string) => void;
  /** 在分组内上移 / 下移；到边界返回 false */
  moveSymbol: (ticker: string, dir: -1 | 1, listId?: string) => boolean;
}

let idSeq = 0;
const newId = (): string => `wl-${Date.now().toString(36)}-${++idSeq}`;

const boot = load();

export const useWatchlistStore = create<WatchlistState>((set, get) => {
  const withActive = (fn: (lists: Watchlist[], activeId: string) => Partial<WatchlistState> | null): void => {
    const { lists, activeId } = get();
    const patch = fn(lists, activeId);
    if (patch) set(patch);
    const next = get();
    persist(next.lists, next.activeId);
  };
  const targetId = (listId?: string): string => listId ?? get().activeId;
  const withList = (listId: string | undefined, fn: (l: Watchlist) => Watchlist | null): void => {
    withActive((lists, activeId) => {
      const id = targetId(listId);
      const idx = lists.findIndex((l) => l.id === id);
      if (idx < 0) return null;
      const next = fn(lists[idx]);
      if (!next) return null;
      const out = lists.slice();
      out[idx] = next;
      return { lists: out };
    });
  };

  return {
    lists: boot.lists,
    activeId: boot.activeId,

    selectList: (id) => withActive((_l, activeId) => (get().lists.some((l) => l.id === id) ? { activeId: id } : null)),
    addList: (name) => {
      const id = newId();
      const list: Watchlist = { id, name: name.trim() || '新建列表', symbols: [] };
      withActive((lists) => ({ lists: [...lists, list], activeId: id }));
      return id;
    },
    removeList: (id) => {
      const { lists } = get();
      if (lists.length <= 1 || !lists.some((l) => l.id === id)) return false;
      withActive((ls, activeId) => {
        const out = ls.filter((l) => l.id !== id);
        return { lists: out, activeId: activeId === id ? out[0].id : activeId };
      });
      return true;
    },
    renameList: (id, name) => withList(id, (l) => ({ ...l, name: name.trim() || l.name })),

    addSymbol: (ticker, listId) => {
      if (!SYMBOL_BY_TICKER.has(ticker)) return false;
      let ok = false;
      withList(listId, (l) => {
        if (l.symbols.includes(ticker)) return null;
        ok = true;
        return { ...l, symbols: [...l.symbols, ticker] };
      });
      return ok;
    },
    removeSymbol: (ticker, listId) => withList(listId, (l) => (l.symbols.includes(ticker) ? { ...l, symbols: l.symbols.filter((t) => t !== ticker) } : null)),
    moveSymbol: (ticker, dir, listId) => {
      let ok = false;
      withList(listId, (l) => {
        const i = l.symbols.indexOf(ticker);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= l.symbols.length) return null;
        ok = true;
        const symbols = l.symbols.slice();
        [symbols[i], symbols[j]] = [symbols[j], symbols[i]];
        return { ...l, symbols };
      });
      return ok;
    },
  };
});
