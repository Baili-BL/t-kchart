import { useEffect, useRef, useState } from 'react';
import { PALETTE_ROWS, normalizeHex, swatchEdge } from './palette';

export { PALETTE, PALETTE_COLS, PALETTE_ROWS, normalizeHex, swatchEdge } from './palette';

/**
 * 页内颜色选择器 —— 对齐线上 TradingView 的取色器。
 *
 * 官方（cn.tradingview.com「设置 → 商品代码 → 主体颜色」，2026-10-18 Playwright 抓取）：
 * 弹层 248 宽 / `6px 12px` 内边距 / 圆角 6 / `0 2px 4px rgba(0,0,0,.2)`；
 * 调色板 10 列 × 8 行、格子 17×17、间距 6、圆角 2、1px 描边（白色块描边 #dbdbdb）；
 * 悬停/选中的外环是 `::after { inset: -5px; border: 2px solid; border-radius: 6px }`；
 * 网格下面一条 1px #dbdbdb 分隔线（上下各 12），再往下是 17×17 的「+」。
 *
 * 诚实边界：官方的「+」打开的是带色相环/不透明度的大取色器，我们这里只有 hex 输入
 * （引擎侧没有 alpha 语义，加不透明度就是假开关）；「恢复默认」也收在这个自定义面板里。
 */

/** 颜色选择器的纯逻辑（hex 规范化、官方调色板）都在 ./palette，这里只做弹层 */

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 无障碍标签（= 颜色行名，如「上涨烛线」） */
  label: string;
  /** 「恢复默认」的目标色（该行的默认值） */
  defaultColor: string;
}

export function ColorPicker({ value, onChange, label, defaultColor }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [hexText, setHexText] = useState(value);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开瞬间同步 hex 文本与位置（跟随触发按钮的视口坐标，弹层用 fixed）
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setCustom(false);
    setHexText(value.toUpperCase());
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = 248;
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 340 - 8)),
      });
    }
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    // 内容区滚动时关掉（fixed 弹层不跟随滚动，宁关勿飘）
    const onScroll = (): void => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (custom) inputRef.current?.focus();
  }, [custom]);

  const pick = (c: string): void => {
    onChange(c);
    setHexText(c.toUpperCase());
    setOpen(false);
  };

  const commitHex = (): void => {
    const v = normalizeHex(hexText);
    if (v) pick(v);
    else setHexText(value.toUpperCase());
  };

  const on = value.toUpperCase();

  return (
    <span ref={rootRef} className="cp-root">
      <button
        type="button"
        ref={btnRef}
        className="st-swatch"
        style={{ background: value }}
        aria-label={`${label}颜色`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="cp-pop" role="dialog" aria-label={`${label}颜色选择器`} style={{ left: pos.left, top: pos.top }}>
          <div className="cp-grid" role="listbox" aria-label="调色板">
            {PALETTE_ROWS.map((row) => row.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={c.toUpperCase() === on}
                aria-label={c}
                title={c}
                className={'cp-cell' + (c.toUpperCase() === on ? ' on' : '')}
                style={{ color: c, borderColor: swatchEdge(c) }}
                onClick={() => pick(c)}
              />
            )))}
          </div>
          <div className="cp-sep" aria-hidden="true" />
          <button
            type="button"
            className="cp-plus"
            title="添加自定义颜色"
            aria-label="添加自定义颜色"
            aria-expanded={custom}
            onClick={() => setCustom((v) => !v)}
          />
          {custom && (
            <div className="cp-custom">
              <span className="cp-custom-preview" style={{ background: hexText }} aria-hidden="true" />
              <input
                ref={inputRef}
                className="cp-hex"
                value={hexText}
                onChange={(e) => setHexText(e.target.value)}
                onBlur={commitHex}
                onKeyDown={(e) => e.key === 'Enter' && commitHex()}
                spellCheck={false}
                aria-label="自定义 hex 颜色"
              />
              <button type="button" className="cp-reset" onClick={() => pick(defaultColor)}>
                恢复默认
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
