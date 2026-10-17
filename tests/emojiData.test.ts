/**
 * emoji 数据对齐 charting_library（TradingView Charting Library）。
 *
 * 参考源：`charting_library/bundles/drawing-toolbar.7f226c0314e0a6d13a77.js` 的 webpack 模块 173，
 * 其导出 `emojiGroups`（最近使用 + 8 个分类）与 `removeUnavailableEmoji`。
 * 分类名取自同版本 zh / en 语言包的同键文案。
 *
 * 这里锁的是「数据与官方一致」：组数、组序、组名、每组条数、首尾元素、无重复、
 * 以及 `removeUnavailableEmoji` 的白名单语义。任何一项漂了，这里会先红。
 * node 环境没有 localStorage，最近使用的读写由浏览器 E2E 覆盖。
 */
import { describe, expect, it } from 'vitest';
import {
  EMOJI_ALL,
  EMOJI_CATEGORIES,
  EMOJI_RECENTS_MAX,
  filterKnownEmoji,
  isKnownEmoji,
} from '../src/workspace/dom/emoji-data';

const OFFICIAL = [
  { key: 'smile', label: '笑脸&人像', labelEn: 'smiles & people', n: 395, first: '😀', last: '👣' },
  { key: 'animal', label: '动物&自然', labelEn: 'animals & nature', n: 183, first: '🐶', last: '🌫' },
  { key: 'food', label: '食物&饮料', labelEn: 'food & drink', n: 114, first: '🍏', last: '🧂' },
  { key: 'sport', label: '活动', labelEn: 'activity', n: 111, first: '⚽️', last: '🧩' },
  { key: 'travel', label: '旅游&地点', labelEn: 'travel & places', n: 125, first: '🚗', last: '🌁' },
  { key: 'object', label: '物品', labelEn: 'objects', n: 247, first: '⌚️', last: '💼' },
  { key: 'symbol', label: '符号', labelEn: 'symbols', n: 288, first: '❤️', last: '🕧' },
  { key: 'flag', label: '旗帜', labelEn: 'flags', n: 257, first: '🏳️', last: '🇿🇼' },
];

describe('emoji 分组：与 charting_library 模块 173 的 emojiGroups 逐组对齐', () => {
  it('8 个分类，组序与官方一致（最近使用由面板单独置顶）', () => {
    expect(EMOJI_CATEGORIES.map((c) => c.key)).toEqual(OFFICIAL.map((o) => o.key));
  });

  it('分类中文名取官方 zh 语言包（含 旅游&地点，旧版曾写成 旅行&地点）', () => {
    expect(EMOJI_CATEGORIES.map((c) => c.label)).toEqual(OFFICIAL.map((o) => o.label));
  });

  it('分类英文名取官方 en 语言包', () => {
    expect(EMOJI_CATEGORIES.map((c) => c.labelEn)).toEqual(OFFICIAL.map((o) => o.labelEn));
  });

  it('每组条数与官方一致（395/183/114/111/125/247/288/257）', () => {
    expect(EMOJI_CATEGORIES.map((c) => c.items.length)).toEqual(OFFICIAL.map((o) => o.n));
    expect(EMOJI_CATEGORIES.reduce((s, c) => s + c.items.length, 0)).toBe(1720);
  });

  it('每组首尾元素与官方一致（顺序照抄，不是「挑一批好看的」）', () => {
    for (const o of OFFICIAL) {
      const cat = EMOJI_CATEGORIES.find((c) => c.key === o.key)!;
      expect(cat.items[0], `${o.key} 首元素`).toBe(o.first);
      expect(cat.items[cat.items.length - 1], `${o.key} 末元素`).toBe(o.last);
    }
  });

  it('组内无重复、组间无重复（官方 1720 条两两不重）', () => {
    for (const c of EMOJI_CATEGORIES) {
      expect(new Set(c.items).size, `${c.key} 组内重复`).toBe(c.items.length);
    }
    expect(new Set(EMOJI_ALL).size).toBe(EMOJI_ALL.length);
    expect(EMOJI_ALL.length).toBe(1720);
  });

  it('国旗组按官方顺序从 🏳️ 起（不是从 🏁 起），且含 🇨🇳 / 🇭🇰', () => {
    const flag = EMOJI_CATEGORIES.find((c) => c.key === 'flag')!.items;
    expect(flag.slice(0, 6)).toEqual(['🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏴‍☠️']);
    expect(flag).toContain('🇨🇳');
    expect(flag).toContain('🇭🇰');
  });

  it('旧版自拟数据里的重复项 🎪 只剩一个（官方活动组内不重）', () => {
    const sport = EMOJI_CATEGORIES.find((c) => c.key === 'sport')!.items;
    expect(sport.filter((c) => c === '🎪')).toHaveLength(1);
  });
});

describe('白名单：对齐官方 removeUnavailableEmoji(e)=e.filter(k.has)', () => {
  it('集内字符通过，集外字符被拒', () => {
    expect(isKnownEmoji('😀')).toBe(true);
    expect(isKnownEmoji('🇨🇳')).toBe(true);
    expect(isKnownEmoji('文字')).toBe(false);
    expect(isKnownEmoji('')).toBe(false);
  });

  it('官方这一版的 emoji 表停在 v13：🫠 🫡 🩷 🧋 🫐 🪿 都不在集内', () => {
    for (const c of ['🫠', '🫡', '🩷', '🧋', '🫐', '🪿', '🛜']) {
      expect(isKnownEmoji(c), `${c} 不该在官方集内`).toBe(false);
    }
  });

  it('过滤保留原顺序，只丢集外项', () => {
    expect(filterKnownEmoji(['😀', 'A', '🚀', '文字', '😀'])).toEqual(['😀', '🚀', '😀']);
    expect(filterKnownEmoji([])).toEqual([]);
    expect(filterKnownEmoji(EMOJI_ALL).length).toBe(1720);
  });

  it('最近使用上限仍是 18（面板一行 9 列 × 2 行）', () => {
    expect(EMOJI_RECENTS_MAX).toBe(18);
  });
});
