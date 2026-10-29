// 把插件管理器装进 DSH。
//
// 和 dsh-feiyu-books 的安装脚本同样的策略：**复制**而不是 link/junction
// （有些 Windows 环境不允许在 node_modules 里创建重解析点，会报 Access denied）。
//
// 使用：
//   node scripts/install.mjs [--dry-run] [--profile desktop]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const PKG_NAME = 'dsh-plugin-manager';
const COPY_FILES = ['package.json', 'index.js', 'ui.html', 'ui.js', 'cordis.patch.yml'];

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const i = argv.indexOf('--profile');
const PROFILE = i >= 0 ? argv[i + 1] : (process.env.DSH_PROFILE || 'desktop');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', PROFILE);
const PROFILE_PKG = path.join(PROFILE_DIR, 'package.json');

function log(m) { console.log(m); }

if (!fs.existsSync(PROFILE_PKG)) {
  console.error(`❌ 找不到 ${PROFILE_PKG}\n   如果 DSH 装在别处，请先设置 DSH_HOME。`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(PROFILE_PKG, 'utf8'));
pkg.dsh = pkg.dsh && typeof pkg.dsh === 'object' ? pkg.dsh : {};
pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === 'object' ? pkg.dsh.profile : {};
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];

const had = bundles.includes(PKG_NAME);
if (!had) bundles.push(PKG_NAME);
pkg.dsh.profile.bundles = bundles;

log(`[1/2] bundle：${had ? '已存在' : '新增'} ${PKG_NAME}`);
if (!dryRun) fs.writeFileSync(PROFILE_PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

const target = path.join(PROFILE_DIR, 'node_modules', PKG_NAME);
log(`[2/2] 复制到 ${target}`);
if (!dryRun) {
  fs.mkdirSync(target, { recursive: true });
  for (const f of COPY_FILES) fs.copyFileSync(path.join(PKG_DIR, f), path.join(target, f));
}

log('');
log('装好了。重启 DSH 后访问：');
log(`  http://127.0.0.1:<DSH 端口>/plugin-manager`);
log('');
log('开关只改配置，不会自动重启 —— 点完自己重启一次 DSH 才生效。');
