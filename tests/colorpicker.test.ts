import { describe, expect, it } from 'vitest';
import { normalizeHex, PALETTE } from '../src/ui/ColorPicker';

describe('ColorPicker 纯逻辑', () => {
  it('normalizeHex：6 位大写规范化', () => {
    expect(normalizeHex('#089981')).toBe('#089981');
    expect(normalizeHex('089981')).toBe('#089981');
    expect(normalizeHex('#f23645'.toUpperCase())).toBe('#F23645');
  });
  it('normalizeHex：3 位扩成 6 位', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('f00')).toBe('#FF0000');
  });
  it('normalizeHex：非法输入返回 null（不静默吃掉）', () => {
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex('#1234567')).toBeNull();
    expect(normalizeHex('#gggggg')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });
  it('调色板：35 色、无重复、全部是合法 #RRGGBB', () => {
    expect(PALETTE.length).toBe(35);
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
    expect(PALETTE.every((c) => normalizeHex(c) !== null)).toBe(true);
  });
  it('调色板包含项目红绿蓝基准色', () => {
    expect(PALETTE).toContain('#f23645');
    expect(PALETTE).toContain('#089981');
    expect(PALETTE).toContain('#2962ff');
  });
});
