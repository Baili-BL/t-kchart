import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../ui/icons';
import { useChatStore } from '../store/chatStore';
import { MODEL_OPTIONS } from './registry';

const PLACEHOLDERS = [
  'Switch to the daily and show 1Y…',
  'Open the Bollinger band…',
  'Layout 2x2 with NVDA…',
];

export function Composer(): JSX.Element {
  const [text, setText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [phIdx, setPhIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const sending = useChatStore((s) => s.sending);
  const modelId = useChatStore((s) => s.modelId);
  const setModel = useChatStore((s) => s.setModel);
  const teach = useChatStore((s) => s.teachMode);
  const setTeach = useChatStore((s) => s.setTeachMode);

  const model = MODEL_OPTIONS.find((m) => m.id === modelId) ?? MODEL_OPTIONS[0];

  useEffect(() => {
    const t = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  const submit = (): void => {
    const v = text.trim();
    if (!v || sending) return;
    setText('');
    void send(v);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Tab 接受占位提示（和输入框右上角的 Tab 提示一致）
    if (e.key === 'Tab' && !e.shiftKey && !text) {
      e.preventDefault();
      setText(PLACEHOLDERS[phIdx].replace(/…$/, ''));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <div className="composer-teach">
        <button
          type="button"
          className={'switch-row' + (teach ? ' on' : '')}
          role="switch"
          aria-checked={teach}
          onClick={() => setTeach(!teach)}
        >
          <Icon name="doc" size={13} />
          <span>Teach mode</span>
          <span className="switch" />
        </button>
      </div>

      <div className="composer-box">
        <div className="composer-input-wrap">
          <textarea
            ref={taRef}
            className="composer-input"
            rows={2}
            value={text}
            placeholder={PLACEHOLDERS[phIdx]}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            aria-label="给 Quant 发消息"
          />
          {!text && <kbd className="composer-tab">Tab</kbd>}
        </div>

        <div className="composer-bar">
          <button type="button" className="icon-btn round" title="添加" aria-label="添加">
            <Icon name="plus" size={14} />
          </button>

          <div className="model-wrap" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="model-btn" onClick={() => setMenuOpen((v) => !v)}>
              {model.label}
              <Icon name="chevronDown" size={12} />
            </button>
            {menuOpen && (
              <ul className="menu model-menu" role="listbox">
                {MODEL_OPTIONS.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={m.id === modelId ? 'sel' : ''}
                      onClick={() => {
                        setModel(m.id);
                        setMenuOpen(false);
                      }}
                    >
                      <span className="menu-check">{m.id === modelId && <Icon name="check" size={13} />}</span>
                      {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <span className="composer-spacer" />

          {sending ? (
            <button type="button" className="send-btn" title="停止" aria-label="停止" onClick={stop}>
              <Icon name="stop" size={14} />
            </button>
          ) : text.trim() ? (
            <button type="button" className="send-btn" title="发送" aria-label="发送" onClick={submit}>
              <Icon name="arrowUp" size={15} strokeWidth={2} />
            </button>
          ) : (
            <button type="button" className="send-btn" title="语音（暂未接入）" aria-label="语音" disabled>
              <Icon name="mic" size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
