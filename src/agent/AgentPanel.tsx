import { useEffect, useRef } from 'react';
import { Icon, BrandMark } from '../ui/icons';
import { useAppStore } from '../store/appStore';
import { useChatStore } from '../store/chatStore';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

/** Try 条的快捷建议：点一下就把文字送进输入框并发送 */
const SUGGESTIONS = [
  { label: 'Indicator', prompt: '打开布林带' },
  { label: 'Timeframe', prompt: '用 1h 周期' },
  { label: 'Layout', prompt: '布局 2x2' },
  { label: 'Symbol', prompt: '切到 NVDA' },
];

export function AgentPanel(): JSX.Element {
  const user = useAppStore((s) => s.user);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const newChat = useChatStore((s) => s.newChat);
  const selectChat = useChatStore((s) => s.selectChat);
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sending);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const latest = conversations[0] ?? null;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [active?.messages]);

  return (
    <section className="agent" aria-label="Agent">
      <header className="agent-head">
        <button type="button" className="icon-btn" title="历史" aria-label="历史">
          <Icon name="history" size={15} />
        </button>
        <button type="button" className="icon-btn" title="新对话" aria-label="新对话" onClick={newChat}>
          <Icon name="plus" size={15} />
        </button>
        <span className="agent-head-spacer" />
        <button type="button" className="icon-btn" title="更多" aria-label="更多">
          <Icon name="dots" size={15} />
        </button>
      </header>

      {active ? (
        <>
          <div className="agent-scroll">
            <MessageList messages={active.messages} sending={sending} />
            <div ref={bottomRef} />
          </div>
          <div className="agent-composer-dock">
            <Composer />
          </div>
        </>
      ) : (
        <div className="agent-welcome">
          <div className="welcome-mark">
            <BrandMark size={26} />
          </div>
          <h2 className="welcome-title">Welcome back, {user.name}</h2>

          <Composer />

          <div className="try-row">
            <Icon name="candles" size={14} />
            <span className="try-label">Try</span>
            <div className="try-chips">
              {SUGGESTIONS.map((s) => (
                <button type="button" key={s.label} className="try-chip" onClick={() => void send(s.prompt)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {latest && (
            <button type="button" className="latest-card" onClick={() => selectChat(latest.id)}>
              <span className="latest-meta">
                <span className="latest-kicker">Your latest chat</span>
                <span className="latest-title">{latest.title}</span>
              </span>
              <Icon name="chevronRight" size={14} />
            </button>
          )}
        </div>
      )}

      <footer className="agent-foot">Quant can make mistakes. Check important results before you trade.</footer>
    </section>
  );
}
