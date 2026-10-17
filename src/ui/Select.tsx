import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from './icons';

/**
 * 统一下拉组件——全应用的下拉都走这里（商品搜索过滤 / Agent 模型选择 / 警报对话框…）。
 * 顶栏的周期 / 样式 / 布局菜单是 dom/toolbar.ts 设计稿原 DOM，按项目约定保留原样，不在此列。
 *
 * 形态：
 * - ghost：纯文字 + 小箭头（工具条 / 过滤行）
 * - field：34px 描边控件（对话框表单，设计稿规格）
 * 单选选中即关闭；multiple 时点击只切换、显示「A, B, C」，点外部 / Esc 才收起。
 * 键盘：↑↓ 移动、Enter 选中、Esc 关闭。
 */
export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string | string[];
  options: SelectOption[];
  onChange: (value: string | string[]) => void;
  /** value 为空时的占位文字 */
  placeholder?: string;
  multiple?: boolean;
  variant?: 'ghost' | 'field';
  /** ghost 的字号（sm 给 Composer 那种小按钮） */
  size?: 'md' | 'sm';
  disabled?: boolean;
  /** 菜单展开方向（Composer 在底部往上弹） */
  placement?: 'bottom' | 'top';
  /** 菜单与触发器的水平对齐 */
  align?: 'left' | 'right';
  /** 无障碍名 */
  label?: string;
}

function selectedLabel(value: string | string[], options: SelectOption[], placeholder: string | undefined): string {
  const arr = Array.isArray(value) ? value : [value];
  const hits = arr.map((v) => options.find((o) => o.value === v)?.label ?? v).filter(Boolean);
  if (Array.isArray(value)) return hits.join(', ') || placeholder || '';
  return hits[0] ?? placeholder ?? '';
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  multiple = false,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  placement = 'bottom',
  align = 'left',
  label,
}: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const values = Array.isArray(value) ? value : [value];
  const active = Array.isArray(value) ? value.length > 0 : value !== '';

  // 点外部 / Esc 关闭（菜单内部的点击不关，否则多选还没响应就被卸载）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (t && t.closest('.ui-select')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setCursor(0);
  }, [open]);

  // 光标跟随滚动
  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[cursor] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const openMenu = (): void => {
    if (disabled || options.length === 0) return;
    const cur = Array.isArray(value) ? 0 : Math.max(0, options.findIndex((o) => o.value === value));
    setCursor(cur);
    setOpen(true);
  };

  const pick = (v: string): void => {
    if (multiple) {
      const arr = values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
      onChange(arr);
    } else {
      onChange(v);
      setOpen(false);
    }
  };

  const onKey = (e: ReactKeyboardEvent): void => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(options.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[cursor];
      if (o) pick(o.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const cls = ['ui-select', `v-${variant}`, size === 'sm' ? 'sm' : '', placement === 'top' ? 'top' : '', align === 'right' ? 'right' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} ref={rootRef} data-open={open}>
      <button
        type="button"
        className="ui-select-btn"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-active={active}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
      >
        <span className="ui-select-value">{selectedLabel(value, options, placeholder)}</span>
        <Icon name="chevronDown" size={variant === 'field' ? 14 : 12} className="ui-select-caret" />
      </button>
      {open && (
        <ul className="ui-select-menu" role="listbox" aria-label={label} ref={listRef} aria-multiselectable={multiple}>
          {options.map((o, i) => {
            const sel = values.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={sel}
                  className={'ui-select-item' + (sel ? ' sel' : '') + (i === cursor ? ' cur' : '')}
                  onClick={() => pick(o.value)}
                  onMouseMove={() => i !== cursor && setCursor(i)}
                >
                  <span className="ui-select-check">{sel && <Icon name="check" size={13} />}</span>
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
