import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/toast';
import { useCompareStore, COMPARE_MAX } from '../store/compareStore';
import { useCompareDialogStore } from '../store/compareDialogStore';
import { SYMBOL_BY_TICKER, searchSymbols } from '../data/symbols';
import type { SymbolEntry } from '../data/symbols';

/** 空查询时给的「最近的商品」—— 指数 / 商品 / 外汇 / 加密各来一个，方便一眼看出比较是干嘛的 */
const RECENT = ['SPX', 'NDX', 'DJI', 'N225', 'GC1!', 'BTCUSD', 'EURUSD'];

/** 字符串 → 稳定色相（与商品代码搜索弹窗同一套规则，保证同名标的颜色一致） */
function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function Badge({ s }: { s: SymbolEntry }): JSX.Element {
  const ch = s.color ? Array.from(s.name)[0] : (Array.from(s.ticker.replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, ''))[0] ?? '?');
  return (
    <span
      className="cmp-badge"
      style={{ background: s.color ?? `hsl(${hue(s.ticker)} 45% 42%)` }}
      aria-hidden="true"
    >
      {ch}
    </span>
  );
}

/**
 * 「比较商品」弹窗（顶栏两个圆点的按钮）。
 *
 * 官方行为：点某一行就**立即添加并关闭**弹窗 —— 没有「确定」按钮。
 * 所以这里也照做；已经加过的行显示「已添加」，点了不再重复加。
 */
export function CompareDialog(): JSX.Element | null {
  const open = useCompareDialogStore((s) => s.open);
  const close = useCompareDialogStore((s) => s.closeDialog);
  const items = useCompareStore((s) => s.items);
  const add = useCompareStore((s) => s.add);
  const showToast = useToast((s) => s.show);

  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setCursor(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const list = useMemo<SymbolEntry[]>(() => {
    const key = q.trim();
    if (!key) return RECENT.map((t) => SYMBOL_BY_TICKER.get(t)).filter((s): s is SymbolEntry => !!s);
    return searchSymbols({ q: key }).slice(0, 60);
  }, [q]);

  useEffect(() => {
    setCursor(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [q]);

  if (!open) return null;

  const added = new Set(items.map((i) => i.ticker));
  const pick = (s: SymbolEntry): void => {
    if (added.has(s.ticker)) return;
    const r = add(s.ticker);
    if (r === 'full') {
      showToast(`最多同时比较 ${COMPARE_MAX} 个商品，先删掉一条再添加`);
      return;
    }
    close();
  };
  const move = (d: number): void => {
    if (!list.length) return;
    const n = (cursor + d + list.length) % list.length;
    setCursor(n);
    (listRef.current?.children[n] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[cursor]) pick(list[cursor]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="modal-mask center" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={onKey}>
      <div className="sym-dialog cmp-dialog" role="dialog" aria-modal="true" aria-label="比较商品">
        <div className="sym-head">
          <h2>比较商品</h2>
          <button type="button" className="sym-close" aria-label="关闭" onClick={close}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="sym-search">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={q}
            placeholder="商品代码、ISIN或CUSIP"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜索要比较的商品"
          />
          {q && (
            <button type="button" className="sym-clear" aria-label="清除" onClick={() => { setQ(''); inputRef.current?.focus(); }}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>

        {q.trim() === '' && <div className="cmp-sec">最近的商品</div>}

        <ul className="sym-list cmp-list" ref={listRef} role="listbox" aria-label="比较商品候选">
          {list.map((s, i) => {
            const on = added.has(s.ticker);
            return (
              <li
                key={s.ticker}
                role="option"
                aria-selected={i === cursor}
                aria-disabled={on}
                data-ticker={s.ticker}
                className={'sym-row cmp-row' + (i === cursor ? ' cur' : '') + (on ? ' on' : '')}
                onMouseMove={() => i !== cursor && setCursor(i)}
                onClick={() => pick(s)}
              >
                <Badge s={s} />
                <span className="cmp-ticker">{s.ticker}</span>
                <span className="sym-name">{s.name}</span>
                <span className="cmp-ex">{s.exchange}</span>
                {on ? <span className="cmp-on">已添加</span> : <span className="cmp-type">{s.kind}</span>}
              </li>
            );
          })}
          {list.length === 0 && <li className="sym-empty">没有找到「{q.trim()}」相关的商品代码</li>}
        </ul>

        <div className="sym-foot">比较线以可见范围左端为 0%，按百分比叠在主图上（演示数据）</div>
      </div>
    </div>
  );
}
