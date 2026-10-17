#!/usr/bin/env node
/**
 * scripts/sync-emoji-twemoji.mjs
 * ---------------------------------------------------------------------------
 * 生成 `src/engine/emoji-twemoji.json`：官方「表情」面板用的是 twemoji
 * 图片（不是系统字体字形），每个 emoji 字符要换成 twemoji 的文件名才能取图。
 *
 * 真值来自两处，都不是抄的：
 *   ① 官方库自己：`charting_library/bundles/library.*.js` 里 `getTwemojiUrl()`
 *      把 base 指到 `https://cdnjs.cloudflare.com/ajax/libs/twemoji/13.0.1/`，
 *      `72x72/<code>.png`（画布上另走 `svg/<code>.svg`）；
 *   ② cn.tradingview.com 的表情面板 DOM 快照（`tests/fixtures/emoji-panel.json`，
 *      6 页共 830 个码点）—— 用来验证「字符 → 文件名」的规则和线上逐字节一致。
 *
 * 规则（拿 830 个线上样本反推，全中）：按「码点 + FE0F 补全 → 原样 → 去 FE0F」
 * 依次试，取第一个真实存在于 twemoji 清单里的文件名。补全是指除 ZWJ(200D) 以外
 * 的每个码点后面都跟一个 FE0F —— twemoji 的资产按「完全限定序列」命名，
 * 因此 1f575-fe0f-200d-2642-fe0f 这种才存在，而 1f575-200d-2642 不存在。
 *
 * 用法：
 *   node scripts/sync-emoji-twemoji.mjs            # 生成（首次联网拉 cdnjs 文件清单，之后走缓存）
 *   node scripts/sync-emoji-twemoji.mjs --check    # 只校对，不写文件
 *   node scripts/sync-emoji-twemoji.mjs --refresh  # 忽略缓存，重新拉清单
 *   node scripts/sync-emoji-twemoji.mjs --offline  # 断网时用：只用缓存，缓存不在就报错
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src/workspace/dom/emoji-source.json');
const OUT = path.join(ROOT, 'src/engine/emoji-twemoji.json');
const FIXTURE = path.join(ROOT, 'tests/fixtures/emoji-panel.json');
const CACHE = path.join(ROOT, 'node_modules/.cache/t-kchart/twemoji-13.0.1.json');

const VERSION = '13.0.1';
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/${VERSION}/`;
const LIST_API = `https://api.cdnjs.com/libraries/twemoji/${VERSION}?fields=files`;
const RULE = '按「非 ZWJ 码点后补 FE0F → 原样 → 去 FE0F」依次试，取第一个在 twemoji 清单里存在的文件名';

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const OFFLINE = args.has('--offline');
const REFRESH = args.has('--refresh');

/** cdnjs 的文件清单（缓存到 node_modules/.cache，避免每次联网） */
async function assetList() {
  if (!REFRESH && fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  if (OFFLINE) throw new Error(`离线模式但缓存不存在：${CACHE}`);
  const res = await fetch(LIST_API);
  if (!res.ok) throw new Error(`拉 twemoji 清单失败：HTTP ${res.status}`);
  const json = await res.json();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify({ files: json.files }));
  return json;
}

/** 码点串（十六进制，小写，'-' 连接） */
function codePoints(ch) {
  return [...ch].map((c) => c.codePointAt(0).toString(16));
}

/** 候选文件名：补全 FE0F → 原样 → 去 FE0F */
function candidates(ch) {
  const cp = codePoints(ch);
  const filled = [];
  for (const c of cp) {
    filled.push(c);
    if (c !== '200d' && c !== 'fe0f') filled.push('fe0f');
  }
  const out = [filled.join('-'), cp.join('-'), cp.filter((c) => c !== 'fe0f').join('-')];
  return [...new Set(out)];
}

/** 归一化：去掉 FE0F，只用来比对「同一个 emoji」 */
const norm = (code) => code.replace(/fe0f/g, '');

async function main() {
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const chars = [...new Set(src.groups.flatMap((g) => g.items))];

  const list = await assetList();
  const png = new Set();
  const svg = new Set();
  for (const f of list.files) {
    if (f.startsWith('72x72/') && f.endsWith('.png')) png.add(f.slice(6, -4));
    else if (f.startsWith('svg/') && f.endsWith('.svg')) svg.add(f.slice(4, -4));
  }
  if (!png.size) throw new Error('twemoji 清单里没有 72x72/png，接口可能变了');

  const map = {};
  const missing = [];
  for (const ch of chars) {
    const hit = candidates(ch).find((c) => png.has(c));
    if (!hit) {
      missing.push(ch);
      continue;
    }
    // svg 是画布端用的（官方 EmojiPaneView 走 svg），两边必须同名
    if (!svg.has(hit)) throw new Error(`svg 缺同名资产：${hit}（字符 ${ch}）`);
    map[ch] = hit;
  }

  // 线上快照校验：830 个码点必须被逐字节复现
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const byNorm = new Map();
  for (const [ch, code] of Object.entries(map)) byNorm.set(norm(code), code);
  const bad = fixture.codes.filter((code) => byNorm.get(norm(code)) !== code);
  if (bad.length) throw new Error(`与线上快照不一致的码点 ${bad.length} 个，例如 ${bad.slice(0, 5)}`);

  const out = {
    source: {
      library: 'twemoji',
      version: VERSION,
      base: BASE,
      dirs: { png: '72x72', svg: 'svg' },
      assetList: LIST_API,
      rule: RULE,
      panelIcon: fixture.panel.asset.icon,
      verified: {
        panelSnapshots: fixture.source.pages.length,
        panelCodes: fixture.codes.length,
        chars: chars.length,
        files: { png: png.size, svg: svg.size },
      },
    },
    map,
  };

  if (missing.length) {
    console.error(`✗ ${missing.length} 个字符在 twemoji ${VERSION} 里没有资产：`, missing.slice(0, 10));
    process.exitCode = 1;
  }

  const text = JSON.stringify(out, null, 1) + '\n';
  if (CHECK) {
    const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (old !== text) {
      console.error('✗ emoji-twemoji.json 与重新生成的结果不一致，跑 `npm run sync:emoji-twemoji`');
      process.exitCode = 1;
    } else {
      console.log(`✓ ${chars.length} 个字符映射一致（twemoji ${VERSION}，${png.size} png / ${svg.size} svg）`);
    }
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log(
    `✓ 写入 ${path.relative(ROOT, OUT)}：${chars.length} 个字符，twemoji ${VERSION}`,
    `\n  线上快照校验：${fixture.codes.length} 个码点全部复现`,
  );
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exitCode = 1;
});
