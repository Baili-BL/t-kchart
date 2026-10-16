import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import { useChartStore } from '../store/chartStore';
import { useSymbolSearchStore } from '../store/symbolSearchStore';
import { CATEGORY_LABELS, CATEGORY_TAG, distinctValues, searchSymbols } from '../data/symbols';
import type { SymbolCategory, SymbolEntry } from '../data/symbols';

type DropKey = 'country' | 'kind' | 'sector';

const DROPS: { key: DropKey; all: string }[] = [
  { key: 'country', all: '所有国家/地区' },
  { key: 'kind', all: '所有类型' },
  { key: 'sector', all: '所有板块' },
];

/** 字符串 → 稳定的色相，给没有品牌色的交易所徽标上色 */
function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function Avatar({ s }: { s: SymbolEntry }): JSX.Element {
  const ch = Array.from(s.ticker.replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, ''))[0] ?? '?';
  return (
    <span className={'sym-avatar' + (s.color ? ' brand' : '')} style={s.color ? { background: s.color } : undefined} aria-hidden="true">
      {s.color ? Array.from(s.name)[0] : ch}
    </span>
  );
}

function ExchangeBadge({ name }: { name: string }): JSX.Element {
  return (
    <span className="sym-ex-badge" style={{ background: `hsl(${hue(name)} 45% 42%)` }} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

/** 下拉：和设计稿一样是「文字 + 小箭头」的纯文字按钮，展开后是一列可选项 */
function Dropdown({
  label, value, options, onChange, disabled,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="sym-dd" ref={ref} data-open={open}>
      <button type="button" className="sym-dd-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} data-active={value !== ''}>
        <span>{value || label}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <ul className="sym-dd-menu" role="listbox">
          {[''].concat(options).map((o) => (
            <li key={o || '__all'}>
              <button type="button" role="option" aria-selected={o === value} className={o === value ? 'sel' : ''}
                onClick={() => { onChange(o); setOpen(false); }}>
                {o || label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 商品代码搜索：屏幕正中的弹窗。搜索框 + 分类胶囊 + 国家 / 类型 / 板块过滤 + 结果列表，键盘 ↑↓ Enter Esc 可用 */
export function SymbolSearchDialog(): JSX.Element | null {
  const open = useSymbolSearchStore((s) => s.open);
  const close = useSymbolSearchStore((s) => s.closeSearch);
  const current = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);

  const [q, setQ] = useState('');
  const [cat, setCat] = useState<SymbolCategory | 'all'>('all');
  const [f, setF] = useState<Record<DropKey, string>>({ country: '', kind: '', sector: '' });
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 每次打开都从干净状态开始
  useEffect(() => {
    if (!open) return;
    setQ('');
    setCat('all');
    setF({ country: '', kind: '', sector: '' });
    setCursor(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // 不带下拉过滤的结果集：用来生成下拉选项（选项来自「已搜到的」，所以选了一定有结果）
  const base = useMemo(() => searchSymbols({ q, category: cat }), [q, cat]);
  const options = useMemo(() => ({
    country: distinctValues(base, 'country'),
    kind: distinctValues(base, 'kind'),
    sector: distinctValues(base, 'sector'),
  }), [base]);
  const list = useMemo(
    () => searchSymbols({ q, category: cat, country: f.country, kind: f.kind, sector: f.sector }),
    [q, cat, f],
  );

  // 结果集变了：光标回到第一行；下拉里已选的值不在新选项里就清掉（否则会卡在 0 结果）
  useEffect(() => {
    setCursor(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [q, cat, f]);
  useEffect(() => {
    setF((p) => {
      const n = { ...p };
      let ch = false;
      for (const k of ['country', 'kind', 'sector'] as DropKey[]) {
        if (n[k] && !options[k].includes(n[k])) { n[k] = ''; ch = true; }
      }
      return ch ? n : p;
    });
  }, [options]);

  if (!open) return null;

  const pick = (s: SymbolEntry): void => {
    if (s.ticker !== current) setSymbol(s.ticker);
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
      <div className="sym-dialog" role="dialog" aria-modal="true" aria-label="商品代码搜索">
        <div className="sym-head">
          <h2>商品代码搜索</h2>
          <button type="button" className="sym-close" aria-label="关闭" onClick={close}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="sym-search">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={q}
            placeholder="搜索代码或名称，例如 000001、茅台、BTC"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜索商品代码"
          />
          {q && (
            <button type="button" className="sym-clear" aria-label="清除" onClick={() => { setQ(''); inputRef.current?.focus(); }}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>

        <div className="sym-pills" role="tablist">
          {CATEGORY_LABELS.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={cat === c.key}
              className={'sym-pill' + (cat === c.key ? ' sel' : '')} onClick={() => setCat(c.key)}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="sym-filters">
          {DROPS.map((d) => (
            <Dropdown key={d.key} label={d.all} value={f[d.key]} options={options[d.key]}
              disabled={options[d.key].length === 0}
              onChange={(v) => setF((p) => ({ ...p, [d.key]: v }))} />
          ))}
        </div>

        <ul className="sym-list" ref={listRef} role="listbox">
          {list.map((s, i) => (
            <li key={s.ticker} role="option" aria-selected={i === cursor} data-ticker={s.ticker}
              className={'sym-row' + (i === cursor ? ' cur' : '') + (s.ticker === current ? ' now' : '')}
              onMouseMove={() => i !== cursor && setCursor(i)} onClick={() => pick(s)}>
              <Avatar s={s} />
              <span className="sym-code">{s.ticker}</span>
              <span className="sym-name">{s.name}</span>
              <span className="sym-tag">{CATEGORY_TAG[s.category]}</span>
              <span className="sym-ex">{s.exchange}</span>
              <ExchangeBadge name={s.exchange} />
            </li>
          ))}
          {list.length === 0 && (
            <li className="sym-empty">没有找到{q.trim() ? `「${q.trim()}」相关的` : '符合条件的'}商品代码</li>
          )}
        </ul>
        <div className="sym-foot">演示数据：名称与交易所为真实标的，价格由程序按固定种子模拟生成</div>
      </div>
    </div>
  );
}
