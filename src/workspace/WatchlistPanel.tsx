import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Icon } from '../ui/icons';
import { useChartStore } from '../store/chartStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { SYMBOL_BY_TICKER, searchSymbols } from '../data/symbols';
import type { SymbolEntry } from '../data/symbols';
import { formatChange, formatPct, formatPrice, formatVolume, isDelayed, marketStatus, quoteFor } from '../data/quote';
import { useToast } from '../ui/toast';

interface Row {
  entry: SymbolEntry;
  ticker: string;
  quote: ReturnType<typeof quoteFor>;
  open: boolean;
}

/** 分组 tab + 列头 + 行情行。点行切标的，右键上移 / 下移 / 移出，+ 内联搜索添加。 */
export function WatchlistPanel(): JSX.Element {
  const lists = useWatchlistStore((s) => s.lists);
  const activeId = useWatchlistStore((s) => s.activeId);
  const selectList = useWatchlistStore((s) => s.selectList);
  const addSymbol = useWatchlistStore((s) => s.addSymbol);
  const removeSymbol = useWatchlistStore((s) => s.removeSymbol);
  const moveSymbol = useWatchlistStore((s) => s.moveSymbol);

  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const toast = useToast((s) => s.show);

  const active = lists.find((l) => l.id === activeId) ?? lists[0];

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; ticker: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 右键菜单：点外面 / Esc 关闭（菜单内部点击不关，否则菜单项还没响应就被卸载）
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (t && t.closest('.wl-menu')) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const rows = useMemo<Row[]>(
    () =>
      active.symbols.map((ticker) => {
        const entry = SYMBOL_BY_TICKER.get(ticker) as SymbolEntry;
        return { entry, ticker, quote: quoteFor(ticker), open: marketStatus(ticker) === 'open' };
      }),
    [active],
  );

  const suggestions = useMemo(() => {
    const q = query.trim();
    return q ? searchSymbols({ q }).slice(0, 8) : [];
  }, [query]);

  const add = (ticker: string): void => {
    const ok = addSymbol(ticker);
    toast(ok ? `已加入 ${active.name}` : '已在自选中');
    if (ok) setQuery('');
  };

  const menuIdx = menu ? active.symbols.indexOf(menu.ticker) : -1;

  /** 面板内相对坐标（.right-panel 的 container-type 使其成为 absolute 的包含块） */
  const openMenu = (e: ReactMouseEvent, ticker: string): void => {
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : e.clientX;
    const y = rect ? e.clientY - rect.top : e.clientY;
    // 简单夹紧，避免菜单在面板底部 / 右缘被裁掉（菜单约 100×120）
    setMenu({
      x: Math.min(x, (rect?.width ?? 300) - 126),
      y: Math.min(y, (rect?.height ?? 400) - 104),
      ticker,
    });
  };

  return (
    <div className="wl-panel" ref={panelRef}>
      <div className="wl-head">
        <div className="wl-tabs" role="tablist" aria-label="自选分组">
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === active.id}
              className={'wl-tab' + (l.id === active.id ? ' on' : '')}
              title={l.name}
              onClick={() => selectList(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" title="添加标的" aria-label="添加标的" onClick={() => setAdding((v) => !v)}>
          <Icon name="plus" size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="更多"
          aria-label="更多操作"
          onClick={() => toast('自选表菜单暂未实现')}
        >
          <Icon name="dots" size={15} />
        </button>
      </div>

      {adding && (
        <div className="wl-add">
          <input
            value={query}
            placeholder="搜索代码或名称，如 600519 / AAPL"
            aria-label="搜索要添加的标的"
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdding(false);
              if (e.key === 'Enter' && suggestions[0]) add(suggestions[0].ticker);
            }}
          />
          {suggestions.length > 0 && (
            <ul className="wl-sug">
              {suggestions.map((s) => (
                <li key={s.ticker}>
                  <button type="button" onMouseDown={() => add(s.ticker)}>
                    <b>{s.ticker}</b>
                    <span>{s.name}</span>
                    <small>{s.exchange}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() !== '' && suggestions.length === 0 && <p className="wl-nomatch">没有匹配的标的</p>}
        </div>
      )}

      <div className="wl-cols" aria-hidden="true">
        <span className="wl-hsym">商品</span>
        <span className="wl-col">最新价</span>
        <span className="wl-col">涨跌</span>
        <span className="wl-col">涨跌%</span>
        <span className="wl-col wl-vol">成交量</span>
      </div>

      {rows.length === 0 ? (
        <p className="wl-empty">列表为空，点右上角 + 添加标的</p>
      ) : (
        <ul className="wl-list">
          {rows.map((r) => {
            const q = r.quote;
            const dir = q.change > 0 ? 'up' : q.change < 0 ? 'down' : 'flat';
            return (
              <li key={r.ticker}>
                <button
                  type="button"
                  className={'wl-row' + (symbol === r.ticker ? ' sel' : '')}
                  title={`${r.entry.exchange}:${r.entry.ticker} ${r.entry.name}`}
                  onClick={() => setSymbol(r.ticker)}
                  onContextMenu={(e) => openMenu(e, r.ticker)}
                >
                  <span className="wl-asset">
                    <span className="wl-logo" style={r.entry.color ? { background: r.entry.color } : undefined}>
                      {r.entry.ticker.slice(0, 1)}
                    </span>
                    <span className="wl-ticker">{r.entry.ticker}</span>
                    {isDelayed(r.ticker) && (
                      <span className="wl-badge" title="行情延时 15 分钟">
                        D
                      </span>
                    )}
                    <span className={'wl-dot' + (r.open ? ' on' : '')} title={r.open ? '交易中' : '休市'} />
                  </span>
                  <span className="wl-col wl-price">{formatPrice(q.last)}</span>
                  <span className={'wl-col ' + dir}>{formatChange(q.change)}</span>
                  <span className={'wl-col ' + dir}>{formatPct(q.changePct)}%</span>
                  <span className="wl-col wl-vol">{formatVolume(q.volume)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {menu && menuIdx >= 0 && (
        <div className="wl-menu" style={{ left: menu.x, top: menu.y }} role="menu" aria-label="自选行操作">
          <button type="button" disabled={menuIdx === 0} onClick={() => moveSymbol(menu.ticker, -1)}>
            上移
          </button>
          <button
            type="button"
            disabled={menuIdx === active.symbols.length - 1}
            onClick={() => moveSymbol(menu.ticker, 1)}
          >
            下移
          </button>
          <button type="button" className="danger" onClick={() => removeSymbol(menu.ticker)}>
            移出自选
          </button>
        </div>
      )}
    </div>
  );
}
