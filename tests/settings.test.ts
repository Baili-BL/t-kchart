/**
 * 图表设置：时区换算 / fmtTime 偏移不变量 / store 默认值与更新。
 * node 环境没有 localStorage，持久化与 hydrate 校验由浏览器 E2E 覆盖。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { fmtTime, fmtCrossTime, setTimezoneShift, timezoneShift } from '../src/engine/chart';
import {
  DEFAULT_SETTINGS, PRECISION_OPTIONS, TZ_OPTIONS, tzShiftMinFor, useChartSettingsStore,
} from '../src/store/chartSettingsStore';

describe('时区', () => {
  afterEach(() => setTimezoneShift(0));

  it('tzShiftMinFor：system 为 0，固定偏移 = 目标 − 系统本地偏移', () => {
    expect(tzShiftMinFor('system')).toBe(0);
    const now = new Date('2026-06-01T00:00:00Z');
    expect(tzShiftMinFor('shanghai', now)).toBe(480 + now.getTimezoneOffset());
    expect(tzShiftMinFor('newyork', now)).toBe(-300 + now.getTimezoneOffset());
  });

  it('TZ_OPTIONS：标签唯一、偏移合法', () => {
    const labels = TZ_OPTIONS.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const o of TZ_OPTIONS) {
      if (o.value === 'system') expect(o.offsetMin).toBeNull();
      else expect(Math.abs(o.offsetMin ?? -1) % 60).toBe(0);
    }
  });

  it('fmtTime：偏移 m 分钟后 = 未偏移时对 t+m 格式化（钟面不变量）', () => {
    const t = Date.UTC(2026, 5, 16, 1, 54); // 09:54 北京
    setTimezoneShift(0);
    const base = fmtTime(t, 30);
    for (const m of [480, -300, 60, -90]) {
      setTimezoneShift(m);
      const shifted = fmtTime(t, 30);
      setTimezoneShift(0);
      expect(shifted).toBe(fmtTime(t + m * 60000, 30));
      setTimezoneShift(m);
      expect(timezoneShift()).toBe(m);
    }
    setTimezoneShift(0);
    expect(fmtTime(t, 30)).toBe(base);
  });

  it('fmtCrossTime：悬浮时间胶囊带星期几', () => {
    setTimezoneShift(0);
    // 2021-09-10 是周五（北京 09:30 → UTC 01:30）
    const t = Date.UTC(2021, 8, 10, 1, 30);
    expect(fmtCrossTime(t, 30)).toBe('周五 2021-09-10 09:30'); // 短跨度：星期 + 完整日期 + 时间
    expect(fmtCrossTime(t, 100)).toBe('周五 09/10'); // 日线以上：星期 + 月/日
    expect(fmtCrossTime(t, 500)).toBe('2021/09'); // 年级跨度：不带星期
    // 偏移不变量：与 fmtTime 同一套钟面换算
    setTimezoneShift(480);
    const shifted = fmtCrossTime(t, 30);
    setTimezoneShift(0);
    expect(shifted).toBe(fmtCrossTime(t + 480 * 60000, 30));
  });
});

describe('chartSettingsStore', () => {
  it('默认值：与引擎/现行配色一致（设计稿同款色值）', () => {
    const s = useChartSettingsStore.getState().settings;
    expect(s.upColor).toBe('#089981');
    expect(s.downColor).toBe('#f23645');
    expect(s.precision).toBe(0);
    expect(s.timezone).toBe('system');
    expect(s.buySell).toBe(false); // 默认隐藏，顶栏「交易」按钮点击后出现
    expect(s.lastDayChange).toBe(false);
  });

  it('set：部分更新不覆盖其它键', () => {
    useChartSettingsStore.getState().set({ precision: 4, name: false });
    const s = useChartSettingsStore.getState().settings;
    expect(s.precision).toBe(4);
    expect(s.name).toBe(false);
    expect(s.upColor).toBe('#089981'); // 未动的键保持
    useChartSettingsStore.getState().set({ precision: 0, name: true });
  });

  it('reset：恢复全部默认', () => {
    useChartSettingsStore.getState().set({ precision: 5, showVolume: false, timezone: 'tokyo' });
    useChartSettingsStore.getState().reset();
    const s = useChartSettingsStore.getState().settings;
    expect(s.precision).toBe(0);
    expect(s.showVolume).toBe(true);
    expect(s.timezone).toBe('system');
  });

  it('PRECISION_OPTIONS：含自动档且数值单调', () => {
    expect(PRECISION_OPTIONS[0]).toEqual({ value: 0, label: '自动' });
    const vals = PRECISION_OPTIONS.map((o) => o.value);
    expect([...vals].sort((a, b) => a - b)).toEqual(vals);
  });

  it('DEFAULT_SETTINGS 的键与勾选行语义完整（防漏字段）', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
      'barChange', 'buySell', 'downColor', 'indBg', 'indInputs', 'indValues', 'lastDayChange',
      'lineColor', 'logo', 'name', 'precision', 'showVolume', 'ticker', 'timezone', 'upColor', 'values',
    ].sort());
  });
});
