import { Icon } from '../ui/icons';
import { useAppStore } from '../store/appStore';
import { useChartStore } from '../store/chartStore';
import { MOCK_SYMBOLS } from '../data/mockBars';

const WATCHLIST_LABEL = '自选表、详情和新闻';

function Watchlist(): JSX.Element {
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  return (
    <ul className="watchlist">
      {MOCK_SYMBOLS.map((s) => (
        <li key={s.ticker}>
          <button type="button" className={s.ticker === symbol ? 'sel' : ''} onClick={() => setSymbol(s.ticker)}>
            <span className="wl-main">
              <b>{s.ticker}</b>
              <small>{s.name}</small>
            </span>
            <span className="wl-last">{s.last.toFixed(2)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * 右侧面板：由右侧图标栏的选中项决定内容。
 * 自选表已可用（点一行切换标的）；其余只是带标题的空态，等对应功能做出来再换。
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
        <Watchlist />
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
