/**
 * emoji 资源层 —— 官方面板与画布上的表情都是 twemoji 图片，不是系统 emoji 字形。
 *
 * 出处（都不是抄的，可复现）：
 *   · `charting_library/bundles/library.*.js` 的 `getTwemojiUrl()` 把 base 指到
 *     `https://cdnjs.cloudflare.com/ajax/libs/twemoji/13.0.1/`：面板用
 *     `72x72/<code>.png`，画布用 `svg/<code>.svg`（官方 EmojiPaneView 拿 svg 再
 *     按 `size` 渲染进方形 viewBox）；图标显示边长 24。
 *   · cn.tradingview.com 表情面板的 DOM 快照（tests/fixtures/emoji-panel.json）：
 *     830 个码点逐字节复现，用来验证「字符 → 文件名」的规则。
 *
 * 对照表由 `scripts/sync-emoji-twemoji.mjs` 生成（`emoji-twemoji.json`）。
 */
import raw from './emoji-twemoji.json';

/** 生成出处：twemoji 版本、CDN base、目录、规则、校验样本量 */
export const TWEMOJI_SOURCE = raw.source;

const MAP = raw.map as Record<string, string>;

/** 字符 → twemoji 文件名（不带扩展名）；未知字符返回空串 */
export function emojiFile(char: string): string {
  return MAP[char] ?? '';
}

/** 面板图标（PNG，官方显示 24×24）的地址 */
export function emojiPngUrl(char: string): string {
  const f = emojiFile(char);
  return f ? `${raw.source.base}${raw.source.dirs.png}/${f}.png` : '';
}

/** 画布用的矢量图标地址（官方 EmojiPaneView 取 svg） */
export function emojiSvgUrl(char: string): string {
  const f = emojiFile(char);
  return f ? `${raw.source.base}${raw.source.dirs.svg}/${f}.svg` : '';
}

/* ---------------------------------------------------------------------------
 * 图片缓存：画布端先拿一张（可能是 null），加载完成后再回调重绘
 * ------------------------------------------------------------------------ */

interface Entry {
  img: HTMLImageElement;
  state: 'loading' | 'ok' | 'error';
  waiters: (() => void)[];
}

const CACHE = new Map<string, Entry>();

/**
 * 取一张已加载完成的 emoji 图；没加载好就返回 null（调用方先画兜底字形），
 * 并在加载完成时回调 `onLoad`（同一个字符多次调用只会在加载完成时各回调一次）。
 * Node / SSR 没有 Image，直接返回 null。
 */
export function loadEmojiImage(char: string, onLoad?: () => void): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const url = emojiSvgUrl(char);
  if (!url) return null;

  let e = CACHE.get(char);
  if (!e) {
    const img = new Image();
    const entry: Entry = { img, state: 'loading', waiters: [] };
    img.decoding = 'async';
    img.addEventListener('load', () => {
      entry.state = 'ok';
      const ws = entry.waiters.splice(0);
      for (const w of ws) w();
    });
    img.addEventListener('error', () => {
      entry.state = 'error';
      entry.waiters.length = 0;
    });
    img.src = url;
    CACHE.set(char, entry);
    e = entry;
  }
  if (onLoad) {
    if (e.state === 'loading') e.waiters.push(onLoad);
    else if (e.state === 'ok') onLoad();
  }
  return e.state === 'ok' ? e.img : null;
}

/** 清空缓存（测试 / 网络恢复后重试用） */
export function clearEmojiImageCache(): void {
  CACHE.clear();
}
