#!/usr/bin/env node
/**
 * 把本机 charting_library 的表情集原样抽出来 —— 不是抄，是把它跑起来。
 *
 * TV 的表情定义在 webpack chunk 的模块 173 里，导出 `emojiGroups` 与
 * `removeUnavailableEmoji`。这个模块依赖 React / i18n / IconItem，但它只在
 * 初始化时「拼数组 + 建元素」，不碰 DOM——所以给一个假的 require 就能在 vm 里
 * 完整执行，拿到的是官方运行时真值，而不是正则从源码里抠出来的字面量。
 *
 * 分类名同样不抄：官方代码是 `i.t(null,{context:"emoji_group"}, o(96330))`，
 * 我们让假 require 记住被问到的模块 id，再用真语言包（zh.4782 / en.4782）
 * 调用那个 id 的工厂，得到的就是官方文案。
 *
 *   用法：
 *     node scripts/sync-tv-emoji.mjs            # 重新生成 emoji-source.json
 *     node scripts/sync-tv-emoji.mjs --check    # 只校对，不一致则退出码 1
 *     CHARTING_LIBRARY_DIR=/path/to/charting_library node scripts/sync-tv-emoji.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(REPO, 'src/workspace/dom/emoji-source.json');
const CHECK = process.argv.includes('--check');

/* ------------------------------------------------ 1. 找到参考库 */
function findLibrary() {
  const roots = [process.env.CHARTING_LIBRARY_DIR, '/Users/kevin/Desktop/charting_library'].filter(Boolean);
  for (const root of roots) {
    for (const sub of ['charting_library/bundles', 'bundles']) {
      const bundles = path.join(root, sub);
      if (fs.existsSync(bundles)) return { root, bundles };
    }
  }
  return null;
}

/** 在 sandbox 里跑一个 webpack chunk，把它的模块表拿出来 */
function captureChunk(file) {
  const code = fs.readFileSync(file, 'utf8');
  const sandbox = {};
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file, timeout: 60000 });
  const chunks = sandbox.webpackChunktradingview || [];
  return Object.assign({}, ...chunks.map((c) => (c && c[1]) || {}));
}

/** 假 require：认识 React / i18n / IconItem，其余一律返回「带 id 的记号」 */
function makeRequire(localeOf) {
  const o = (id) => {
    const v = localeOf ? localeOf(id) : undefined;
    if (v !== undefined) return v;
    if (id === 50959) return { createElement: () => null, Fragment: 'Fragment' };
    if (id === 44352) return { t: (_k, _opts, val) => val === undefined ? '' : val };
    if (id === 99616) return { IconItem: () => null };
    return { __moduleId: id };
  };
  o.d = (target, defs) => {
    for (const k of Object.keys(defs)) {
      Object.defineProperty(target, k, { get: defs[k], enumerable: true });
    }
  };
  o.r = () => {};
  o.n = (m) => m;
  return o;
}

/* ------------------------------------------------ 2. 定位导出 emojiGroups 的模块 */
function locateModule(bundles, files) {
  const candidates = files.filter((f) => {
    const s = fs.readFileSync(path.join(bundles, f), 'utf8');
    return s.includes('removeUnavailableEmoji:()=>');
  });
  if (!candidates.length) throw new Error('参考库里找不到 emojiGroups 导出（chunk 结构可能变了）');

  for (const file of candidates) {
    const abs = path.join(bundles, file);
    const src = fs.readFileSync(abs, 'utf8');
    const at = src.indexOf('removeUnavailableEmoji:()=>');
    // 往前找最近的模块声明 `173:(e,t,o)=>{`
    const anchors = [...src.matchAll(/(\d+):\((?:\w,){0,5}\w\)=>/g)].filter((m) => m.index < at);
    const owner = anchors.pop();
    if (!owner) continue;
    let mods;
    try { mods = captureChunk(abs); } catch (_e) { continue; }
    const factory = mods[owner[1]];
    if (typeof factory !== 'function') continue;
    return { file, abs, moduleId: owner[1], factory };
  }
  throw new Error('找到了导出但模块执行不了（chunk 结构可能变了）');
}

/* ------------------------------------------------ 3. 语言包 */
function firstString(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

function loadLocale(bundles, side, ids) {
  const files = fs.readdirSync(bundles)
    .filter((f) => new RegExp(`^${side}\\.\\d+\\.`).test(f))
    .sort();
  for (const file of files) {
    let mods;
    try { mods = captureChunk(path.join(bundles, file)); } catch (_e) { continue; }
    const map = {};
    for (const id of ids) {
      const factory = mods[id];
      if (typeof factory !== 'function') continue;
      try {
        const e = { exports: {} };
        factory(e, e.exports, () => ({}));
        const v = firstString(e.exports);
        if (v) map[id] = v;
      } catch (_e) { /* 该模块吃了别的依赖，跳过 */ }
    }
    if (Object.keys(map).length === ids.length) return { file, map };
  }
  throw new Error(`参考库 ${side} 语言包里找不到表情分类名（key: ${ids.join(',')}）`);
}

/* ------------------------------------------------ 4. 抽取 */
function extract() {
  const lib = findLibrary();
  if (!lib) {
    throw new Error('找不到 charting_library，请用 CHARTING_LIBRARY_DIR 指定（需含 charting_library/bundles）');
  }
  // 排序保证同一份库在不同机器上选到同一个 chunk（readdir 顺序不保证）
  const files = fs.readdirSync(lib.bundles).filter((f) => f.endsWith('.js')).sort();
  const mod = locateModule(lib.bundles, files);

  const out = { exports: {} };
  mod.factory(out, out.exports, makeRequire(null));
  const groups = out.exports.emojiGroups;
  const removeUnavailable = out.exports.removeUnavailableEmoji;
  if (!Array.isArray(groups) || typeof removeUnavailable !== 'function') {
    throw new Error('模块执行成功但导出不符合预期');
  }

  // 组名：官方代码把 locale 模块 id 交给 i18n，这里把 id 记下来
  const localeIds = groups.map((g) => {
    const t = g && g.title;
    const id = t && typeof t === 'object' ? t.__moduleId : null;
    if (!Number.isInteger(id)) throw new Error('有分组没有 locale key，结构可能变了');
    return id;
  });

  const zh = loadLocale(lib.bundles, 'zh', localeIds);
  const en = loadLocale(lib.bundles, 'en', localeIds);

  const rows = groups.map((g, i) => ({
    localeKey: localeIds[i],
    label: zh.map[localeIds[i]],
    labelEn: en.map[localeIds[i]],
    items: Array.from(g.emojis || []),
  }));

  // ------- 自检：跑出来的东西得能解释得通，否则宁可失败也别写坏数据
  if (rows.length !== 9) throw new Error(`官方分组应为 9 组（最近使用 + 8 分类），实际 ${rows.length}`);
  const recents = rows[0];
  if (recents.items.length !== 0) throw new Error('首页应为空的「最近使用」组');
  for (const r of rows.slice(1)) {
    if (r.items.length < 50) throw new Error(`分组「${r.label}」只有 ${r.items.length} 个，疑似抽错`);
  }
  const all = rows.flatMap((r) => r.items);
  const dup = all.length - new Set(all).size;
  if (dup > 0) throw new Error(`字符集里有 ${dup} 个重复，官方数据不应如此`);

  // removeUnavailableEmoji 必须是「按并集过滤」，否则我们复刻的白名单语义就错了
  const probe = [all[0], '文字', 'A', all[all.length - 1]];
  const kept = removeUnavailable(probe);
  if (kept.length !== 2 || kept[0] !== all[0] || kept[1] !== all[all.length - 1]) {
    throw new Error('removeUnavailableEmoji 语义不是「按并集过滤」，需要重新核对');
  }

  const pkg = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(lib.root, 'package.json'), 'utf8')); } catch (_e) { return {}; }
  })();

  return {
    source: {
      generator: 'scripts/sync-tv-emoji.mjs',
      library: path.basename(lib.root),
      version: pkg.version || 'unknown',
      chunk: mod.file,
      module: mod.moduleId,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(mod.abs)).digest('hex'),
      locale: { zh: zh.file, en: en.file },
      api: ['emojiGroups', 'removeUnavailableEmoji'],
    },
    groups: rows,
  };
}

/* ------------------------------------------------ 5. 写盘 / 校对 */
const data = extract();
const text = JSON.stringify(data, null, 2) + '\n';
const total = data.groups.reduce((s, g) => s + g.items.length, 0);

if (CHECK) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (old === text) {
    console.log(`✔ 表情数据与 charting_library ${data.source.version} 一致（${total} 个字符 / ${data.groups.length - 1} 组）`);
    process.exit(0);
  }
  const oldData = (() => { try { return JSON.parse(old); } catch (_e) { return null; } })();
  console.error('✘ 表情数据与参考库不一致，请运行 npm run sync:emoji');
  if (oldData && Array.isArray(oldData.groups)) {
    console.error(`  旧：${oldData.groups.reduce((s, g) => s + (g.items || []).length, 0)} 个字符，来源 ${oldData.source && oldData.source.version}`);
    console.error(`  新：${total} 个字符，来源 ${data.source.version}`);
  }
  process.exit(1);
}

fs.writeFileSync(OUT, text);
console.log(`✔ 已写入 ${path.relative(REPO, OUT)}`);
console.log(`  charting_library ${data.source.version} · ${data.source.chunk} · 模块 ${data.source.module}`);
console.log(`  ${data.groups.length - 1} 组 / ${total} 个字符`);
for (const g of data.groups) {
  console.log(`  ${String(g.localeKey).padEnd(6)} ${g.label.padEnd(10)} ${String(g.items.length).padStart(4)}  ${g.items.slice(0, 3).join('')}…${g.items.slice(-2).join('')}`);
}
