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

// 顺序不能反：pine 依赖 chart 里的 log()
const files = ['chart.js', 'pine.js'];
let src = '';
for (const f of files) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) {
    console.error('缺少 ' + f + '，先跑 tsc');
    process.exit(2);
  }
  src += '\n/* ==== ' + f + ' ==== */\n' + fs.readFileSync(p, 'utf8');
}
src += '\nglobalThis.__pine = pineSelfTest();\n';

try {
  vm.runInContext(src, sandbox, { filename: 'bundle.js' });
} catch (e) {
  console.error('\n✗ 执行时抛异常：');
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
}

const res = sandbox.__pine;
console.log('');
console.log('================ Pine 自检 ================');
console.log('  ' + res.pass + ' PASS / ' + res.fail + ' FAIL   (共 ' + (res.pass + res.fail) + ' 条)');
if (res.fail) {
  console.log('\n  失败项：');
  for (const n of res.names) if (n.indexOf('FAIL') === 0) console.log('    ' + n);
}
console.log('===========================================');
process.exit(res.fail ? 1 : 0);
