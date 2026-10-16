import { describe, expect, it } from 'vitest';
import { LAYOUTS, layoutsSelfTest } from '../src/engine/layouts';
import { LAYOUT_ICONS } from '../src/ui/layoutIcons';

describe('多图布局目录', () => {
  it('自检全部通过（≥ 300 条）', () => {
    const r = layoutsSelfTest();
    expect(r.failures).toEqual([]);
    expect(r.pass).toBeGreaterThanOrEqual(300);
  });

  it('每种布局都有对应的设计稿图标，且没有多余的图标', () => {
    expect(Object.keys(LAYOUT_ICONS).sort()).toEqual(LAYOUTS.map((l) => l.id).sort());
    for (const l of LAYOUTS) {
      const ic = LAYOUT_ICONS[l.id];
      expect(ic.body.includes('<path') || ic.body.includes('<rect')).toBe(true);
      expect(ic.body).not.toMatch(/<script|on\w+=|javascript:/i);
    }
  });
});
