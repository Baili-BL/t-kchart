import type { ReactNode } from 'react';
import { Icon, BrandMark } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { useAppStore } from '../store/appStore';
import type { NavKey } from '../store/appStore';
import { useChatStore } from '../store/chatStore';

interface NavDef {
  key: NavKey;
  label: string;
  icon: IconName;
  /** 带二级入口的项显示右箭头 */
  expandable?: boolean;
}

const TRADING: NavDef[] = [
  { key: 'strategies', label: 'Strategies', icon: 'trendingUp', expandable: true },
  { key: 'alerts', label: 'Alerts', icon: 'bell', expandable: true },
];
const RESEARCH: NavDef[] = [{ key: 'screener', label: 'Strategy Screener', icon: 'filter' }];

function NavItem({ def, active, collapsed }: { def: NavDef; active: boolean; collapsed: boolean }): JSX.Element {
  const setNav = useAppStore((s) => s.setNav);
  return (
    <button
      type="button"
      className={'nav-item' + (active ? ' active' : '')}
      title={collapsed ? def.label : undefined}
      onClick={() => setNav(def.key)}
    >
      <Icon name={def.icon} size={16} />
      {!collapsed && <span className="nav-label">{def.label}</span>}
      {!collapsed && def.expandable && <Icon name="chevronRight" size={13} className="nav-caret" />}
    </button>
  );
}

function Group({ title, collapsed, children }: { title: string; collapsed: boolean; children: ReactNode }): JSX.Element {
  return (
    <div className="nav-group">
      {!collapsed && <div className="nav-group-title">{title}</div>}
      {children}
    </div>
  );
}

export function Sidebar(): JSX.Element {
  const nav = useAppStore((s) => s.nav);
  const setNav = useAppStore((s) => s.setNav);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const user = useAppStore((s) => s.user);

  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const selectChat = useChatStore((s) => s.selectChat);

  const openChat = (id: string): void => {
    setNav('quant');
    selectChat(id);
  };

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')} aria-label="主导航">
      <div className="sidebar-head">
        <span className="brand">
          <BrandMark size={20} />
          {!collapsed && <span className="brand-name">t-kchart</span>}
        </span>
        {!collapsed && (
          <span className="head-actions">
            <button type="button" className="icon-btn" title="搜索" aria-label="搜索">
              <Icon name="search" size={15} />
            </button>
            <button type="button" className="icon-btn" title="收起侧栏" aria-label="收起侧栏" onClick={toggle}>
              <Icon name="sidebar" size={15} />
            </button>
          </span>
        )}
      </div>
      {collapsed && (
        <button type="button" className="icon-btn expand" title="展开侧栏" aria-label="展开侧栏" onClick={toggle}>
          <Icon name="sidebar" size={15} />
        </button>
      )}

      <nav className="sidebar-body">
        <div className="nav-group">
          <button
            type="button"
            className={'nav-item' + (nav === 'quant' ? ' active' : '')}
            title={collapsed ? 'Quant' : undefined}
            onClick={() => setNav('quant')}
          >
            <Icon name="zap" size={16} />
            {!collapsed && <span className="nav-label">Quant</span>}
          </button>
        </div>

        <Group title="Trading" collapsed={collapsed}>
          {TRADING.map((d) => (
            <NavItem key={d.key} def={d} active={nav === d.key} collapsed={collapsed} />
          ))}
        </Group>

        <Group title="Research" collapsed={collapsed}>
          {RESEARCH.map((d) => (
            <NavItem key={d.key} def={d} active={nav === d.key} collapsed={collapsed} />
          ))}
        </Group>

        {!collapsed && (
          <Group title="Quant chats" collapsed={collapsed}>
            {conversations.map((c) => (
              <button
                type="button"
                key={c.id}
                className={'chat-item' + (nav === 'quant' && c.id === activeId ? ' active' : '')}
                title={c.title}
                onClick={() => openChat(c.id)}
              >
                {c.title}
              </button>
            ))}
          </Group>
        )}
      </nav>

      <div className="sidebar-foot">
        {!collapsed && (
          <div className="credits">
            <span className="credits-dot" />
            <span>AI credits</span>
            <span className="credits-n">{user.credits}</span>
            <Icon name="plus" size={12} />
          </div>
        )}
        <div className="user-card">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          {!collapsed && (
            <>
              <span className="user-meta">
                <span className="user-name">{user.name}</span>
                <span className="user-mail">{user.email}</span>
              </span>
              <Icon name="chevronDown" size={14} className="user-caret" />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
