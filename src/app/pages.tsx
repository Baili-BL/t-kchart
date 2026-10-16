import { useEffect, useRef } from 'react';
import { createBottom } from '../workspace/dom/bottom';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';

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

const ALERTS = [
  { id: 1, symbol: 'TSLA', cond: 'Price crosses 380.00', state: 'Active' },
  { id: 2, symbol: 'NVDA', cond: 'Price below 180.00', state: 'Paused' },
];

export function AlertsPage(): JSX.Element {
  return (
    <PageShell icon="bell" title="Alerts" desc="警报面板占位（TODO 2.11）。下面是静态示例数据。">
      <table className="page-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Condition</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {ALERTS.map((a) => (
            <tr key={a.id}>
              <td>
                <b>{a.symbol}</b>
              </td>
              <td>{a.cond}</td>
              <td>{a.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PageShell>
  );
}

export function ScreenerPage(): JSX.Element {
  return (
    <PageShell icon="filter" title="Strategy Screener" desc="策略筛选器占位：后续接入回测结果库后，在这里按夏普 / 回撤 / 胜率筛选。" />
  );
}
