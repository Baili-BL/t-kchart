import { useEffect, useRef } from 'react';
import { createBottom } from '../workspace/dom/bottom';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { useAlertStore } from '../store/alertStore';
import { ALERT_STATE_LABELS, formatAlertTime } from '../store/alertStore';
import { useAlertDialogStore } from '../store/alertDialogStore';
import { alertConditionText } from '../workspace/AlertDialog';
import { formatPrice } from '../data/quote';

function PageShell({
  icon,
  title,
  desc,
  children,
}: {
  icon: IconName;
  title: string;
  desc: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="page">
      <header className="page-head">
        <Icon name={icon} size={18} />
        <h1>{title}</h1>
      </header>
      <p className="page-desc">{desc}</p>
      {children}
    </div>
  );
}

/** Strategies：复用现有的「策略报告概览」面板（dom/bottom.ts） */
export function StrategiesPage(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createBottom(host, {}, { strategyName: 'MACD strategy' });
    return () => handle.root.remove();
  }, []);
  return (
    <PageShell icon="trendingUp" title="Strategies" desc="策略报告概览（演示数据）。真实回测依赖 Pine strategy.* 撮合，见 TODO 2.1。">
      <div ref={hostRef} className="page-embed" />
    </PageShell>
  );
}

export function AlertsPage(): JSX.Element {
  const alerts = useAlertStore((s) => s.alerts);
  const logs = useAlertStore((s) => s.logs);
  const togglePause = useAlertStore((s) => s.togglePause);
  const removeAlert = useAlertStore((s) => s.removeAlert);
  const openDialog = useAlertDialogStore((s) => s.openDialog);

  return (
    <PageShell icon="bell" title="Alerts" desc="警报管理：条件由假变真时触发（引擎只评估当前图表标的的最新价，见 alertStore 头注释）。">
      <button type="button" className="page-btn" onClick={openDialog}>
        <Icon name="plus" size={14} />
        创建警报
      </button>
      {alerts.length === 0 ? (
        <p className="page-desc">还没有警报，点上面「创建警报」新建一个。</p>
      ) : (
        <table className="page-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>条件</th>
              <th>触发</th>
              <th>到期时间</th>
              <th>状态</th>
              <th>最近触发 / 创建</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td>
                  <b>{a.ticker}</b>
                </td>
                <td>{alertConditionText(a)}</td>
                <td>{a.trigger === 'once' ? '仅一次' : '每次'}</td>
                <td>{a.expires == null ? '—' : formatAlertTime(a.expires)}</td>
                <td className={'al-state ' + (a.state === 'triggered' ? 'up' : '')}>{ALERT_STATE_LABELS[a.state]}</td>
                <td>{formatAlertTime(a.triggeredAt ?? a.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={a.state !== 'active' && a.state !== 'paused'}
                    onClick={() => togglePause(a.id)}
                  >
                    {a.state === 'paused' ? '恢复' : '暂停'}
                  </button>
                  <button type="button" className="link-btn danger" onClick={() => removeAlert(a.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="page-desc" style={{ marginTop: 18 }}>
        触发日志（{logs.length}）：最新 {logs[0] ? `${logs[0].text} · ${formatAlertTime(logs[0].at)}` : '暂无'}
      </p>
    </PageShell>
  );
}

export function ScreenerPage(): JSX.Element {
  return (
    <PageShell icon="filter" title="Strategy Screener" desc="策略筛选器占位：后续接入回测结果库后，在这里按夏普 / 回撤 / 胜率筛选。" />
  );
}
