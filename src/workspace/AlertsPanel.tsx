import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Icon } from '../ui/icons';
import { useChartStore } from '../store/chartStore';
import { useAlertDialogStore } from '../store/alertDialogStore';
import { useAlertStore } from '../store/alertStore';
import type { AlertItem } from '../store/alertStore';
import { ALERT_STATE_LABELS, formatAlertTime } from '../store/alertStore';
import { useToast } from '../ui/toast';

type Tab = 'alerts' | 'logs';

const STATE_CLASS: Record<string, string> = { active: '', triggered: 'ok', paused: '', expired: 'dim' };

function AlertRow({ a, origin }: { a: AlertItem; origin: (e: ReactMouseEvent) => { x: number; y: number } }): JSX.Element {
  const setSymbol = useChartStore((s) => s.setSymbol);
  const symbol = useChartStore((s) => s.symbol);
  const togglePause = useAlertStore((s) => s.togglePause);
  const removeAlert = useAlertStore((s) => s.removeAlert);
  const toast = useToast((s) => s.show);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (t && t.closest('.wl-menu')) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openMenu = (e: ReactMouseEvent): void => {
    e.preventDefault();
    setMenu(origin(e));
  };

  const stateLabel = ALERT_STATE_LABELS[a.state];

  return (
    <li>
      <div
        className={'al-row-item' + (symbol === a.ticker ? ' sel' : '')}
        title={`${a.message}（右键管理）`}
        role="button"
        tabIndex={0}
        onClick={() => setSymbol(a.ticker)}
        onContextMenu={openMenu}
        onKeyDown={(e) => e.key === 'Enter' && setSymbol(a.ticker)}
      >
        <b>{a.ticker}</b>
        <span className={'al-bullet ' + STATE_CLASS[a.state]}>•</span>
        <span className={'al-status ' + STATE_CLASS[a.state]}>{stateLabel}</span>
        <span className="al-time">{formatAlertTime(a.triggeredAt ?? a.createdAt)}</span>
      </div>
      {menu && (
        <div className="wl-menu" style={{ left: menu.x, top: menu.y }} role="menu" aria-label="警报操作">
          <button
            type="button"
            disabled={a.state !== 'active' && a.state !== 'paused'}
            onClick={() => {
              togglePause(a.id);
              setMenu(null);
            }}
          >
            {a.state === 'paused' ? '恢复' : '暂停'}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              removeAlert(a.id);
              toast('警报已删除');
              setMenu(null);
            }}
          >
            删除
          </button>
        </div>
      )}
    </li>
  );
}

/** 右侧「警报」面板：警报 / 日志 两个 tab（设计稿行结构：ticker • 状态 • 时间） */
export function AlertsPanel(): JSX.Element {
  const alerts = useAlertStore((s) => s.alerts);
  const logs = useAlertStore((s) => s.logs);
  const clearLogs = useAlertStore((s) => s.clearLogs);
  const openDialog = useAlertDialogStore((s) => s.openDialog);
  const [tab, setTab] = useState<Tab>('alerts');
  const panelRef = useRef<HTMLDivElement>(null);

  // 菜单坐标相对面板（.wl-panel 是 positioned 祖先）
  const origin = (e: ReactMouseEvent): { x: number; y: number } => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div className="wl-panel al-panel" ref={panelRef}>
      <div className="wl-head">
        <div className="wl-tabs" role="tablist" aria-label="警报分区">
          <button type="button" role="tab" aria-selected={tab === 'alerts'} className={'wl-tab' + (tab === 'alerts' ? ' on' : '')} onClick={() => setTab('alerts')}>
            警报
          </button>
          <button type="button" role="tab" aria-selected={tab === 'logs'} className={'wl-tab' + (tab === 'logs' ? ' on' : '')} onClick={() => setTab('logs')}>
            日志
          </button>
        </div>
        {tab === 'logs' && logs.length > 0 && (
          <button type="button" className="al-clear" onClick={clearLogs}>
            清空
          </button>
        )}
        <button type="button" className="icon-btn" title="创建警报" aria-label="创建警报" onClick={openDialog}>
          <Icon name="plus" size={15} />
        </button>
      </div>

      {tab === 'alerts' ? (
        alerts.length === 0 ? (
          <p className="wl-empty">还没有警报，点右上角 + 创建</p>
        ) : (
          <ul className="wl-list al-list">
            {alerts.map((a) => (
              <AlertRow key={a.id} a={a} origin={origin} />
            ))}
          </ul>
        )
      ) : logs.length === 0 ? (
        <p className="wl-empty">暂无触发日志</p>
      ) : (
        <ul className="wl-list al-list">
          {logs.map((l) => (
            <li key={l.id}>
              <div className="al-row-item log" title={l.text}>
                <span className="al-log-text">{l.text}</span>
                <span className="al-time">{formatAlertTime(l.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
