import { describe, expect, it } from 'vitest';
import { RANGES } from '../src/engine/chart';

/**
 * 显示范围条的中文文案。
 *
 * 官方中文版截图（cn.tradingview.com）那一行是：
 *   `1天 5天 1个月 3个月 6个月 YTD 1年 5年 全部 | 📅`
 * 本项目跨度第二项是 7 天，所以写「7天」——文案如实，不为了长得像而改语义。
 *
 * 关键契约：**只改 label（界面文案），不改 key（内部标识）**。
 * key 被 setRange / 布局存档 / Agent 工具参数引用，动了就全炸。
 */

const CJK = /[\u4e00-\u9fff]/;
const LATIN = /[A-Za-z]/;

describe('显示范围条：中文文案', () => {
  it('key 与顺序一个都没动（存档 / setRange / Agent 契约）', () => {
    expect(RANGES.map((r) => r.key)).toEqual(['1D', '7D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'ALL']);
  });

  it('每一项的界面文案与官方中文版一致（第二项为 7天，不是 5天）', () => {
    expect(RANGES.map((r) => r.label)).toEqual([
      '1天',
      '7天',
      '1个月',
      '3个月',
      '6个月',
      'YTD',
      '1年',
      '5年',
      '全部',
    ]);
  });

  it('除 YTD 外，每个文案都含汉字（不再有 1D / ALL 这类英文缩写漏网）', () => {
    for (const r of RANGES) {
      if (r.key === 'YTD') continue;
      expect(CJK.test(r.label), `${r.key} → ${r.label}`).toBe(true);
    }
  });

  it('除 YTD 外，文案里不再出现拉丁字母', () => {
    for (const r of RANGES) {
      if (r.key === 'YTD') continue;
      expect(LATIN.test(r.label), `${r.key} → ${r.label}`).toBe(false);
    }
  });

  it('YTD 保持官方写法（官方中文版也没翻成年初至今）', () => {
    expect(RANGES.find((r) => r.key === 'YTD')?.label).toBe('YTD');
  });

  it('ALL 是「全部」，不是「所有」/「全部数据」', () => {
    expect(RANGES.find((r) => r.key === 'ALL')?.label).toBe('全部');
  });

  it('文案唯一（避免两个按钮同名，用户点了不知道点哪个）', () => {
    const labels = RANGES.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('毫秒跨度没被文案改动带偏（1D/7D/1M/3M/6M/1Y/5Y）', () => {
    const day = 86400000;
    const span = (k: string): number | null | undefined => RANGES.find((r) => r.key === k)?.ms;
    expect(span('1D')).toBe(day);
    expect(span('7D')).toBe(7 * day);
    expect(span('1M')).toBe(30 * day);
    expect(span('3M')).toBe(91 * day);
    expect(span('6M')).toBe(182 * day);
    expect(span('1Y')).toBe(365 * day);
    expect(span('5Y')).toBe(1825 * day);
  });

  it('YTD / ALL 仍然靠数据算（ms 为 null）', () => {
    expect(RANGES.find((r) => r.key === 'YTD')?.ms).toBeNull();
    expect(RANGES.find((r) => r.key === 'ALL')?.ms).toBeNull();
  });

  it('文案里的数字与 key 对得上（1D→1天、6M→6个月、5Y→5年，不会错位）', () => {
    const expectNum: Record<string, string> = {
      '1D': '1',
      '7D': '7',
      '1M': '1',
      '3M': '3',
      '6M': '6',
      '1Y': '1',
      '5Y': '5',
    };
    for (const r of RANGES) {
      const n = expectNum[r.key];
      if (!n) continue;
      expect(r.label.startsWith(n), `${r.key} → ${r.label}`).toBe(true);
    }
  });

  it('月 / 年 / 天 的单位词用对（个月 / 年 / 天，不是「月」「天」混叫成「个月」）', () => {
    const byKey = Object.fromEntries(RANGES.map((r) => [r.key, r.label]));
    expect(byKey['1D'].endsWith('天')).toBe(true);
    expect(byKey['1M'].endsWith('个月')).toBe(true);
    expect(byKey['3M'].endsWith('个月')).toBe(true);
    expect(byKey['6M'].endsWith('个月')).toBe(true);
    expect(byKey['1Y'].endsWith('年')).toBe(true);
    expect(byKey['5Y'].endsWith('年')).toBe(true);
  });
});
