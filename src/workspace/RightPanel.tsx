import { Icon } from '../ui/icons';
import { useAppStore } from '../store/appStore';
import { WatchlistPanel } from './WatchlistPanel';
import { AlertsPanel } from './AlertsPanel';

const WATCHLIST_LABEL = '自选表、详情和新闻';
const ALERTS_LABEL = '警报';

/**
 * 右侧面板：由右侧图标栏的选中项决定内容。
 * 自选表（分组 / 列头 / 行情行）与警报（警报 / 日志）已可用；其余是带标题的空态，等对应功能做出来再换。
 */
export function RightPanel(): JSX.Element | null {
  const kind = useAppStore((s) => s.rightPanel);
  const close = useAppStore((s) => s.closeRightPanel);
  if (kind == null) return null;
  return (
    <aside className="right-panel" aria-label={kind}>
      <header className="right-panel-head">
        <span>{kind}</span>
        <button type="button" className="icon-btn" title="关闭" aria-label="关闭面板" onClick={close}>
          <Icon name="close" size={14} />
        </button>
      </header>
      {kind === WATCHLIST_LABEL ? (
        <WatchlistPanel />
      ) : kind === ALERTS_LABEL ? (
        <AlertsPanel />
      ) : (
        <div className="right-panel-empty">
          <Icon name="panel" size={22} />
          <p className="empty-title">{kind}</p>
          <p className="empty-desc">该面板尚未实现。</p>
        </div>
      )}
    </aside>
  );
}
