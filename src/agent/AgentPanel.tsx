import { useEffect, useRef, useState } from 'react';
import { Icon, BrandMark } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { useAppStore } from '../store/appStore';
import type { NavKey } from '../store/appStore';
import { useChatStore } from '../store/chatStore';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { AlertsPage, ScreenerPage, StrategiesPage } from '../app/pages';

/** Try 条的快捷建议：点一下就把文字送进输入框并发送 */
const SUGGESTIONS = [
  { label: 'Indicator', prompt: '打开布林带' },
  { label: 'Timeframe', prompt: '用 1h 周期' },
  { label: 'Layout', prompt: '布局 2x2' },
  { label: 'Symbol', prompt: '切到 NVDA' },
];

/** 面板顶部 tab：对话 = Quant 聊天，其余三个是原左侧导航栏的入口 */
const TABS: { key: NavKey; label: string; icon: IconName }[] = [
  { key: 'quant', label: '对话', icon: 'zap' },
  { key: 'strategies', label: '策略', icon: 'trendingUp' },
  { key: 'alerts', label: '警报', icon: 'bell' },
  { key: 'screener', label: '筛选', icon: 'filter' },
];

export function AgentPanel(): JSX.Element {
  const user = useAppStore((s) => s.user);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const nav = useAppStore((s) => s.nav);
  const setNav = useAppStore((s) => s.setNav);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const newChat = useChatStore((s) => s.newChat);
  const selectChat = useChatStore((s) => s.selectChat);
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sending);

  /** 历史列表（原侧栏「Quant chats」）展开态 */
  const [histOpen, setHistOpen] = useState(false);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const latest = conversations[0] ?? null;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [active?.messages]);

  const openChat = (id: string): void => {
    selectChat(id);
    setNav('quant');
    setHistOpen(false);
  };

  return (
    <section className="agent" aria-label="Agent">
      <header className="agent-head">
        {/*
         * 品牌行（原应用顶栏并入）：Quant 品牌 + 主题切换 + Feedback。
         * 头像在底部 agent-foot；「显示/隐藏 Agent」由图表区右缘 AI Copilot 按钮承担。
         */}
        <div className="agent-brand-row">
          <div className="tab active" title="Quant">
            <BrandMark size={13} />
            <span>Quant</span>
          </div>
          <span className="agent-head-spacer" />
          <button
            type="button"
            className="icon-btn"
            title={theme === 'light' ? '切到深色' : '切到浅色'}
            aria-label="切换主题"
            onClick={toggleTheme}
          >
            <Icon name="moon" size={15} />
          </button>
          <button type="button" className="feedback-btn">
            <Icon name="feedback" size={13} />
            Feedback
          </button>
        </div>
        <div className="agent-tab-row">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.key}
              className={'agent-tab' + (nav === t.key ? ' on' : '')}
              aria-pressed={nav === t.key}
              title={t.label}
              onClick={() => setNav(t.key)}
            >
              <Icon name={t.icon} size={14} />
              <span>{t.label}</span>
            </button>
          ))}
          <span className="agent-head-spacer" />
          <button type="button" className="icon-btn" title="新对话" aria-label="新对话" onClick={newChat}>
            <Icon name="plus" size={15} />
          </button>
        </div>
      </header>

      {nav === 'quant' ? (
        <>
          {histOpen && (
            <div className="agent-hist" role="list" aria-label="Quant chats">
              <div className="agent-hist-title">Quant chats</div>
              {conversations.length === 0 && <p className="agent-hist-empty">还没有对话</p>}
              {conversations.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  role="listitem"
                  className={'chat-item' + (c.id === activeId ? ' active' : '')}
                  title={c.title}
                  onClick={() => openChat(c.id)}
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
          {active ? (
            <>
              <div className="agent-scroll">
                <MessageList messages={active.messages} sending={sending} />
                <div ref={bottomRef} />
              </div>
              <div className="agent-composer-dock">
                <button
                  type="button"
                  className={'hist-toggle' + (histOpen ? ' on' : '')}
                  aria-pressed={histOpen}
                  title="历史对话"
                  onClick={() => setHistOpen((v) => !v)}
                >
                  <Icon name="history" size={14} />
                  <span>历史</span>
                </button>
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
                <button
                  type="button"
                  className={'hist-toggle' + (histOpen ? ' on' : '')}
                  aria-pressed={histOpen}
                  title="历史对话"
                  onClick={() => setHistOpen((v) => !v)}
                >
                  <Icon name="history" size={14} />
                  <span>历史</span>
                </button>
                <span className="try-label">Try</span>
                <div className="try-chips">
                  {SUGGESTIONS.map((s) => (
                    <button type="button" key={s.label} className="try-chip" onClick={() => void send(s.prompt)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {latest && !histOpen && (
                <button type="button" className="latest-card" onClick={() => openChat(latest.id)}>
                  <span className="latest-meta">
                    <span className="latest-kicker">Your latest chat</span>
                    <span className="latest-title">{latest.title}</span>
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="agent-page">
          {nav === 'strategies' && <StrategiesPage />}
          {nav === 'alerts' && <AlertsPage />}
          {nav === 'screener' && <ScreenerPage />}
        </div>
      )}

      <footer className="agent-foot">
        <div className="agent-acct">
          <span className="credits">
            <span className="credits-dot" />
            <span>AI credits</span>
            <span className="credits-n">{user.credits}</span>
          </span>
          <span className="avatar sm" title={user.email}>
            {user.name.slice(0, 1).toUpperCase()}
          </span>
        </div>
        Quant can make mistakes. Check important results before you trade.
      </footer>
    </section>
  );
}
