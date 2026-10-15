/**
 * tv-chart / run-tests.js
 * ---------------------------------------------------------------------------
 * 在 Node 里跑 Pine 引擎自检（不需要浏览器）。
 *
 * chart.js / pine.js 都是经典脚本（无 import/export），所以在同一个 vm
 * 上下文里按顺序拼接执行即可，不需要打包器。
 *
 *   node run-tests.js
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = __dirname;

const sandbox = {
  console: console,
  Date: Date, Math: Math, JSON: JSON,
  Map: Map, Set: Set, WeakMap: WeakMap,
  Object: Object, Array: Array, Number: Number, String: String, Boolean: Boolean,
  RegExp: RegExp, Error: Error, TypeError: TypeError, RangeError: RangeError,
  Symbol: Symbol, isFinite: isFinite, isNaN: isNaN,
  parseFloat: parseFloat, parseInt: parseInt,
  Infinity: Infinity, NaN: NaN, undefined: undefined,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// 顺序不能反：draw / pine / equity 都依赖 chart 里的 log() 等
const files = ['chart.js', 'draw.js', 'pine.js', 'equity.js', 'analytics.js'];
let src = '';
for (const f of files) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) {
    console.error('缺少 ' + f + '，先跑 tsc');
    process.exit(2);
  }
  src += '\n/* ==== ' + f + ' ==== */\n' + fs.readFileSync(p, 'utf8');
}
src += '\nglobalThis.__draw = drawSelfTest();\n';
src += 'globalThis.__pine = pineSelfTest();\n';
src += 'globalThis.__eq = equitySelfTest();\n';
src += 'globalThis.__an = analyticsSelfTest();\n';

try {
  vm.runInContext(src, sandbox, { filename: 'bundle.js' });
} catch (e) {
  console.error('\n✗ 执行时抛异常：');
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
}

const draw = sandbox.__draw;
const res = sandbox.__pine;
const eqres = sandbox.__eq;
const anres = sandbox.__an;

function report(title, r) {
  console.log('');
  console.log('=============== ' + title + ' ===============');
  console.log('  ' + r.pass + ' PASS / ' + r.fail + ' FAIL   (共 ' + (r.pass + r.fail) + ' 条)');
  if (r.fail) {
    console.log('\n  失败项：');
    for (const n of r.names) if (n.indexOf('FAIL') === 0) console.log('    ' + n);
  }
}
report('绘图层自检', draw);
report('Pine 自检', res);
report('权益图自检（纯计算部分）', eqres);
report('统计组件自检（纯计算部分）', anres);
console.log('===========================================');
console.log('  合计 ' + (draw.pass + res.pass + eqres.pass + anres.pass) + ' PASS / ' +
  (draw.fail + res.fail + eqres.fail + anres.fail) + ' FAIL');
process.exit(draw.fail + res.fail + eqres.fail + anres.fail ? 1 : 0);
