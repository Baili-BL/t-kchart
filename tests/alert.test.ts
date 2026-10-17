import { beforeEach, describe, expect, it } from 'vitest';
import {
  alertMessage,
  evaluateAlert,
  formatAlertTime,
  hydrateAlerts,
  resetPriceFeed,
  serializeAlerts,
  useAlertStore,
} from '../src/store/alertStore';
import type { AlertDraft, AlertItem } from '../src/store/alertStore';

// ---------------------------------------------------------------- 纯函数

describe('evaluateAlert · 条件由假变真才触发', () => {
  it('上穿：前值 ≤ 阈值 且 现价 > 阈值', () => {
    expect(evaluateAlert('crossUp', 100, 99, 100.5)).toBe(true);
    expect(evaluateAlert('crossUp', 100, 100, 100.5)).toBe(true); // 从阈值上也算穿
    expect(evaluateAlert('crossUp', 100, 100.5, 101)).toBe(false); // 本来就在上方
    expect(evaluateAlert('crossUp', 100, 99, 100)).toBe(false); // 到了但没穿过去
  });

  it('下穿 / 穿过（双向）', () => {
    expect(evaluateAlert('crossDown', 100, 101, 99.5)).toBe(true);
    expect(evaluateAlert('crossDown', 100, 99, 98)).toBe(false);
    expect(evaluateAlert('crossing', 100, 99, 101)).toBe(true);
    expect(evaluateAlert('crossing', 100, 101, 99)).toBe(true);
    expect(evaluateAlert('crossing', 100, 100, 100)).toBe(false);
  });

  it('高于 / 低于：变真的那一根触发', () => {
    expect(evaluateAlert('above', 100, 99.9, 100)).toBe(true);
    expect(evaluateAlert('above', 100, 100, 100.5)).toBe(false); // 一直是真，不再触发
    expect(evaluateAlert('below', 100, 100.1, 100)).toBe(true);
    expect(evaluateAlert('below', 100, 100, 99)).toBe(false);
  });

  it('非有限输入一律 false', () => {
    expect(evaluateAlert('crossing', NaN, 99, 101)).toBe(false);
    expect(evaluateAlert('crossing', 100, NaN, 101)).toBe(false);
    expect(evaluateAlert('crossing', 100, 99, Infinity)).toBe(false);
  });
});

describe('消息与时间格式', () => {
  it('消息格式：代码，价格 条件 值', () => {
    expect(alertMessage('TSLA', 'crossing', 100)).toBe('TSLA，价格 穿过 100.00');
    expect(alertMessage('600519', 'above', 1500)).toBe('600519，价格 高于 1,500.00');
  });

  it('时间格式：周X YYYY-MM-DD HH:mm:ss（2025-06-16 是周一）', () => {
    expect(formatAlertTime(new Date(2025, 5, 16, 9, 54, 10).getTime())).toBe('周一 2025-06-16 09:54:10');
    expect(formatAlertTime(new Date(2026, 0, 1, 0, 0, 5).getTime())).toBe('周四 2026-01-01 00:00:05');
  });
});

// ---------------------------------------------------------------- store

function draft(p: Partial<AlertDraft> = {}): AlertDraft {
  return { ticker: 'TSLA', op: 'crossUp', value: 100, trigger: 'once', expires: null, notify: ['app'], ...p };
}

describe('alertStore · 创建与触发', () => {
  beforeEach(() => {
    useAlertStore.setState({ alerts: [], logs: [] });
    resetPriceFeed();
  });

  it('addAlert：默认 active，消息自动生成', () => {
    const a = useAlertStore.getState().addAlert(draft());
    expect(a.state).toBe('active');
    expect(a.message).toBe('TSLA，价格 上穿 100.00');
    expect(useAlertStore.getState().alerts.length).toBe(1);
  });

  it('processTick：第一根只建基线；穿越触发；仅一次触发后不再触发', () => {
    const s = useAlertStore.getState();
    s.addAlert(draft());
    expect(s.processTick('TSLA', 99)).toHaveLength(0); // 基线
    expect(s.processTick('TSLA', 99.5)).toHaveLength(0); // 没穿越
    const fired = s.processTick('TSLA', 100.5);
    expect(fired).toHaveLength(1);
    const st = useAlertStore.getState();
    expect(st.alerts[0].state).toBe('triggered');
    expect(st.alerts[0].triggeredAt).not.toBeNull();
    expect(st.logs.length).toBe(1);
    expect(st.logs[0].text).toContain('上穿 100.00');
    // 已触发不再评估
    expect(s.processTick('TSLA', 99)).toHaveLength(0);
    expect(s.processTick('TSLA', 101)).toHaveLength(0);
  });

  it('每次触发：来回穿越反复触发并记日志', () => {
    const s = useAlertStore.getState();
    s.addAlert(draft({ trigger: 'every', op: 'crossing' }));
    s.processTick('TSLA', 99);
    expect(s.processTick('TSLA', 101)).toHaveLength(1);
    expect(s.processTick('TSLA', 100.5)).toHaveLength(0);
    expect(s.processTick('TSLA', 99)).toHaveLength(1);
    const st = useAlertStore.getState();
    expect(st.logs.length).toBe(2);
    expect(st.alerts[0].state).toBe('active'); // 每次触发的警报保持 active
  });

  it('其它标的的 tick 不影响本警报', () => {
    const s = useAlertStore.getState();
    s.addAlert(draft());
    s.processTick('NVDA', 99);
    expect(s.processTick('NVDA', 101)).toHaveLength(0);
  });

  it('已暂停 / 已过期不触发；过期状态会被标记', () => {
    const s = useAlertStore.getState();
    const a = s.addAlert(draft());
    useAlertStore.setState({ alerts: [{ ...a, state: 'paused' }] });
    s.processTick('TSLA', 99);
    expect(s.processTick('TSLA', 101)).toHaveLength(0);

    // 过期：expires 在过去 → 第一个 tick 就转 expired，之后永不触发
    useAlertStore.setState({ alerts: [], logs: [] });
    resetPriceFeed();
    const b = s.addAlert(draft({ expires: Date.now() - 1000 }));
    s.processTick('TSLA', 99);
    expect(useAlertStore.getState().alerts.find((x) => x.id === b.id)?.state).toBe('expired');
    expect(s.processTick('TSLA', 101)).toHaveLength(0);
  });

  it('togglePause：active ↔ paused；triggered 不可暂停', () => {
    const s = useAlertStore.getState();
    const a = s.addAlert(draft());
    s.togglePause(a.id);
    expect(useAlertStore.getState().alerts[0].state).toBe('paused');
    s.togglePause(a.id);
    expect(useAlertStore.getState().alerts[0].state).toBe('active');
    useAlertStore.setState({ alerts: [{ ...(useAlertStore.getState().alerts[0]), state: 'triggered' }] });
    s.togglePause(useAlertStore.getState().alerts[0].id);
    expect(useAlertStore.getState().alerts[0].state).toBe('triggered');
  });

  it('removeAlert / clearLogs', () => {
    const s = useAlertStore.getState();
    const a = s.addAlert(draft());
    s.addAlert(draft({ ticker: 'NVDA' }));
    s.removeAlert(a.id);
    expect(useAlertStore.getState().alerts.length).toBe(1);
    useAlertStore.setState({ logs: [{ id: 'l1', ticker: 'TSLA', text: 'x', at: 1 }] });
    useAlertStore.getState().clearLogs();
    expect(useAlertStore.getState().logs.length).toBe(0);
  });
});

describe('alertStore · 存档往返', () => {
  it('serialize → hydrate 往返一致', () => {
    const now = Date.now();
    const alerts: AlertItem[] = [
      {
        id: 'a1',
        ticker: 'TSLA',
        op: 'crossUp',
        value: 100,
        trigger: 'once',
        expires: null,
        message: 'TSLA，价格 上穿 100.00',
        notify: ['app', 'sound'],
        state: 'active',
        triggeredAt: null,
        createdAt: now,
      },
    ];
    const logs = [{ id: 'l1', ticker: 'TSLA', text: 'x', at: now }];
    expect(hydrateAlerts(serializeAlerts(alerts, logs))).toEqual({ alerts, logs });
  });

  it('损坏 / 版本不对 / 结构缺失 → 空存档（调用方回默认）', () => {
    expect(hydrateAlerts(null)).toEqual({ alerts: [], logs: [] });
    expect(hydrateAlerts('garbage{')).toEqual({ alerts: [], logs: [] });
    expect(hydrateAlerts(JSON.stringify({ v: 2, alerts: [], logs: [] }))).toEqual({ alerts: [], logs: [] });
    expect(hydrateAlerts(JSON.stringify({ v: 1, alerts: 'nope', logs: [] }))).toEqual({ alerts: [], logs: [] });
  });

  it('字段缺失给安全默认值，不静默编数据', () => {
    const back = hydrateAlerts(
      JSON.stringify({ v: 1, alerts: [{ id: 'a1', ticker: 'TSLA', value: 100 }], logs: [] }),
    );
    expect(back.alerts[0].op).toBe('crossing');
    expect(back.alerts[0].state).toBe('active');
    expect(back.alerts[0].message).toBe('TSLA，价格 穿过 100.00');
  });
});
