/**
 * emoji 资源层：字符 → twemoji 文件名 / 面板尺寸，对齐 cn.tradingview.com。
 *
 * 两道真值：
 *   ① 官方库 `library.*.js` 的 `getTwemojiUrl()`：base 指 cdnjs twemoji 13.0.1，
 *      面板取 `72x72/<code>.png`，画布取 `svg/<code>.svg`；
 *   ② `tests/fixtures/emoji-panel.json`：6 页表情面板 DOM 快照，830 个码点、
 *      面板宽/行高/列数/图标尺寸/标题样式 —— 全部是计算后的布局，不是估的。
 *
 * 这里锁的是「映射规则 + 尺寸」；数据量与分组仍由 emojiData.test.ts 锁。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/emoji-panel.json';
import { EMOJI_ALL, EMOJI_CATEGORIES } from '../src/workspace/dom/emoji-data';
import { EMOJI_PANEL } from '../src/workspace/dom/emoji-panel-metrics';
import {
  TWEMOJI_SOURCE, clearEmojiImageCache, emojiFile, emojiPngUrl, emojiSvgUrl, loadEmojiImage,
} from '../src/engine/emojiAssets';

const CODE_RE = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;
const norm = (code: string): string => code.replace(/fe0f/g, '');

describe('emoji 资源映射：1720 个字符全部对得上 twemoji 13.0.1', () => {
  it('每个官方字符都有文件名，且两两不撞', () => {
    const codes = EMOJI_ALL.map((ch) => emojiFile(ch));
    expect(codes.filter((c) => !c)).toEqual([]);
    expect(codes.length).toBe(1720);
    expect(new Set(codes).size).toBe(1720);
  });

  it('文件名是「小写十六进制码点用 - 连接」（允许 fe0f / 200d 参与）', () => {
    for (const ch of EMOJI_ALL) expect(emojiFile(ch), ch).toMatch(CODE_RE);
  });

  it('没收录的字符返回空串 / 空地址（不瞎拼一个 404 出来）', () => {
    expect(emojiFile('🧑‍🚀‍👩')).toBe('');
    expect(emojiPngUrl('🧑‍🚀‍👩')).toBe('');
    expect(emojiSvgUrl('🧑‍🚀‍👩')).toBe('');
  });

  it('出处：twemoji 13.0.1 + cdnjs base + 72x72 / svg 两个目录', () => {
    expect(TWEMOJI_SOURCE.version).toBe('13.0.1');
    expect(TWEMOJI_SOURCE.base).toBe('https://cdnjs.cloudflare.com/ajax/libs/twemoji/13.0.1/');
    expect(TWEMOJI_SOURCE.dirs).toEqual({ png: '72x72', svg: 'svg' });
    expect(TWEMOJI_SOURCE.verified.chars).toBe(1720);
  });
});

describe('emoji 资源映射：拿线上面板快照（830 个码点）逐字节核对', () => {
  const reverse = new Map(EMOJI_ALL.map((ch) => [norm(emojiFile(ch)), emojiFile(ch)]));

  it('快照里的每个码点都等于我们的文件名（不是「同一个 emoji 的另一种写法」）', () => {
    const bad = fixture.codes.filter((code) => reverse.get(norm(code)) !== code);
    expect(bad).toEqual([]);
    expect(fixture.codes.length).toBe(830);
  });

  it('FE0F 的取舍按线上来：有的保留（🏳️‍🌈）、有的不保留（❤️）', () => {
    // 彩虹旗的资产名带 fe0f，红心的不带 —— 这是 twemoji 按「完全限定序列」命名的结果，
    // 不能一刀切去 fe0f，也不能一刀切补 fe0f，只能按资产表试。
    expect(emojiFile('🏳️‍🌈')).toBe('1f3f3-fe0f-200d-1f308');
    expect(emojiFile('❤️')).toBe('2764');
    // 职业 emoji 反过来：补 fe0f 的那版不存在，线上用的就是裸序列
    expect(emojiFile('👨‍💼')).toBe('1f468-200d-1f4bc');
  });

  it('快照里的分组标题都在我们的分类里（组名照官方语言包，没自造）', () => {
    const labels = new Set(EMOJI_CATEGORIES.map((c) => c.label));
    const seen = fixture.slices.flatMap((s) => s.groups.map((g) => g.label)).filter((l): l is string => !!l);
    const unknown = [...new Set(seen)].filter((l) => l !== '最近使用' && !labels.has(l));
    expect(unknown).toEqual([]);
    expect([...new Set(seen)].sort()).toEqual(
      ['最近使用', '动物&自然', '笑脸&人像', '活动', '旅游&地点', '食物&饮料'].sort(),
    );
  });
});

describe('emoji 资源地址：面板走 png、画布走 svg（官方两个入口）', () => {
  it('png 地址 = base + 72x72/<code>.png', () => {
    expect(emojiPngUrl('😀')).toBe(`${TWEMOJI_SOURCE.base}72x72/1f600.png`);
  });

  it('svg 地址 = base + svg/<code>.svg', () => {
    expect(emojiSvgUrl('😀')).toBe(`${TWEMOJI_SOURCE.base}svg/1f600.svg`);
  });

  it('Node 里没有 Image：加载器直接给 null（渲染层退回字形）', () => {
    clearEmojiImageCache();
    expect(loadEmojiImage('😀')).toBeNull();
  });
});

describe('emoji 面板尺寸：与官方 DOM 快照一致', () => {
  it('面板 349 宽 / 一行 9 格 / 行高 38 / 图标 24 / 左右留 6', () => {
    expect(EMOJI_PANEL.width).toBe(fixture.panel.width);
    expect(EMOJI_PANEL.columns).toBe(fixture.panel.columns);
    expect(EMOJI_PANEL.rowHeight).toBe(fixture.panel.rowHeight);
    expect(EMOJI_PANEL.icon).toBe(fixture.panel.iconSize);
    expect(EMOJI_PANEL.paddingInline).toBe(fixture.panel.paddingInline);
    expect([EMOJI_PANEL.width, EMOJI_PANEL.columns, EMOJI_PANEL.rowHeight, EMOJI_PANEL.icon])
      .toEqual([349, 9, 38, 24]);
  });

  it('分组标题：30 高 / 11px / 字距 .4 / 左缩进 18 / 上内边距 6 / 灰 #808080', () => {
    expect(EMOJI_PANEL.header).toEqual(fixture.panel.header);
    expect(EMOJI_PANEL.header.color).toBe('rgb(128, 128, 128)');
  });

  it('9 个 38px 的格子比 337px 宽 —— 官方是靠 flex 压到 37.44 塞进去的', () => {
    const content = EMOJI_PANEL.width - EMOJI_PANEL.paddingInline * 2;
    expect(EMOJI_PANEL.columns * EMOJI_PANEL.rowHeight).toBeGreaterThan(content);
    expect(content / EMOJI_PANEL.columns).toBeCloseTo(37.44, 2);
  });

  it('最近使用一行 9 格 × 2 行 = 18 条上限（面板宽度没变，列数没变）', () => {
    expect(EMOJI_PANEL.columns * 2).toBe(18);
  });
});

describe('emoji 资源表与生成脚本逐字节一致', () => {
  const cache = path.resolve(__dirname, '../node_modules/.cache/t-kchart/twemoji-13.0.1.json');
  it.skipIf(!fs.existsSync(cache))('跑一遍 --check --offline', () => {
    const out = execFileSync('node', ['scripts/sync-emoji-twemoji.mjs', '--check', '--offline'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });
    expect(out).toContain('1720 个字符映射一致');
  });
});
