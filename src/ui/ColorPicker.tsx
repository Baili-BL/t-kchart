import { useEffect, useRef, useState } from 'react';

/**
 * 页内颜色选择器（TradingView「设置 → 样式」经典样式）。
 * 设计稿链接（magicpatterns c7c97790）已 404，按 TV 经典口径实现：
 * 调色板网格 + 自定义 hex 输入 + 恢复默认。
 * 诚实边界：不含不透明度滑块——当前引擎/设置链路没有 alpha 语义，加了就是假开关；
 * 引擎侧接入 #RRGGBBAA 后再加。
 */

/** 调色板：7 列 × 5 行（灰阶 + 红/橙/黄 + 绿系 + 青蓝 + 紫粉，含项目红绿 #f23645 / #089981 / #2962ff） */
export const PALETTE: string[] = [
  '#ffffff', '#e6e9ef', '#d1d4dc', '#b2b5be', '#787b86', '#434651', '#131722',
  '#f23645', '#ff7043', '#ff9800', '#ffb74d', '#ffd54f', '#ffee58', '#fdd835',
  '#c6ff00', '#aed581', '#66bb6a', '#26a69a', '#089981', '#00897b', '#00695c',
  '#26c6da', '#29b6f6', '#2962ff', '#1565c0', '#0d47a1', '#3f51b5', '#5e35b1',
  '#7e57c2', '#9c27b0', '#ab47bc', '#e57fd1', '#f06292', '#f8bbd0', '#fce4ec',
];

/** hex 规范化：接受 3/6 位（可带 #），非法返回 null；输出大写 #RRGGBB */
export function normalizeHex(raw: string): string | null {
  const s = raw.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return null;
  const six = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return `#${six.toUpperCase()}`;
}

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
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [hexText, setHexText] = useState(value);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开瞬间同步 hex 文本与位置（跟随触发按钮的视口坐标，弹层用 fixed）
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setHexText(value.toUpperCase());
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = 196;
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: r.bottom + 6,
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

  const pick = (c: string): void => {
    onChange(c);
    setHexText(c.toUpperCase());
  };

  const commitHex = (): void => {
    const v = normalizeHex(hexText);
    if (v) pick(v);
    else setHexText(value.toUpperCase());
  };

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
          <div className="cp-head">
            <span className="cp-title">自定义颜色</span>
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
          </div>
          <div className="cp-grid" role="listbox" aria-label="调色板">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={c.toUpperCase() === value.toUpperCase()}
                aria-label={c}
                className={'cp-cell' + (c.toUpperCase() === value.toUpperCase() ? ' on' : '')}
                style={{ background: c }}
                onClick={() => pick(c)}
              />
            ))}
          </div>
          <div className="cp-foot">
            <button type="button" className="cp-reset" onClick={() => pick(defaultColor)}>
              恢复默认
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
