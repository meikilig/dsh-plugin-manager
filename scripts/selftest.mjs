// 插件管理器的自测：不启动 DSH，直接调纯函数。
//
// 验证三件事：
//   1. 能找到 profile、列出 bundle；
//   2. 受保护的插件会被拒绝关闭；
//   3. 对不存在的插件名，写操作是幂等安全的（不会炸）。
//
// 注意：测试**不会**真的改配置 —— 只调 setEnabled 的「拒绝」分支。
import { findProfileDir, listPlugins, setEnabled } from '../index.js';

let failed = 0;
function check(label, cond, extra = '') {
  if (cond) { console.log(`  ✅ ${label}`); }
  else { console.log(`  ❌ ${label} ${extra}`); failed++; }
}

console.log('1) 找 profile');
const prof = findProfileDir();
check('找到 profile', Boolean(prof), JSON.stringify(prof?.dir ?? null));

console.log('2) 列插件');
const r = listPlugins();
check('ok=true', r.ok === true, r.error || '');
check('至少 1 个 bundle', Array.isArray(r.items) && r.items.length >= 1);
const names = (r.items || []).map((x) => x.id);
check('包含 surfcore', names.includes('surfcore'));
const surf = (r.items || []).find((x) => x.id === 'surfcore');
check('surfcore 标记为受保护', surf?.protected === true);

console.log('3) 拒绝关闭受保护插件');
const denied = setEnabled('surfcore', false);
check('setEnabled(surfcore,false) 被拒', denied.ok === false, JSON.stringify(denied));

console.log('4) 空名字必须被拒绝');
const empty = setEnabled('', true);
check('setEnabled("") 被拒绝', empty.ok === false, JSON.stringify(empty));

console.log('');
if (failed) { console.log(`❌ ${failed} 项失败`); process.exit(1); }
console.log('✅ 全部通过');
