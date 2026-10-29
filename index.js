// dsh-plugin-manager：在 DSH 里列出所有已装插件，带开关。
//
// 设计取舍（重要）：
//   · 开关 = 改 profile 的 dsh.profile.bundles 数组，**不自动重启** ——
//     用户点完自己重启 DSH 才生效。自动重启会打断正在跑的会话。
//   · 核心 bundle（surfcore / dsh-base / dsh-web-app）**不允许关闭**，
//     服务端直接拒绝对它们的写请求，UI 上也把开关置灰。
//   · 页面是同一台机器上的同源页面，复用 DSH 自己的会话鉴权（connection.requestRejection），
//     不额外发明 token。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_FILE = path.join(HERE, 'ui.html');

export const name = 'dsh-plugin-manager';
export { findProfileDir, listPlugins, setEnabled };
export const inject = ['webServer'];

/** 这些 bundle 不给关：关掉会让 DSH 或 QQ 桥接直接瘫痪。 */
const PROTECTED = new Set(['surfcore', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-manager']);

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

function log(msg) {
  try { console.log('[plugin-manager] ' + msg); } catch { }
}

/** 找到当前正在用的 profile：bundle 列表里包含本插件的那个。 */
function findProfileDir() {
  const root = path.join(DSH_HOME, 'profiles');
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return null; }
  for (const d of dirs) {
    const p = path.join(root, d, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      const bundles = pkg?.dsh?.profile?.bundles;
      if (Array.isArray(bundles) && bundles.includes(name)) return { dir: path.join(root, d), pkg, pkgPath: p };
    } catch { }
  }
  // 兜底：只有一个 profile 就用它
  if (dirs.length === 1) {
    const p = path.join(root, dirs[0], 'package.json');
    try { return { dir: path.join(root, dirs[0]), pkg: JSON.parse(fs.readFileSync(p, 'utf8')), pkgPath: p }; } catch { return null; }
  }
  return null;
}

/** 读某个已装包的元信息（版本、描述、是不是真有 dsh.bundle）。 */
function readPluginMeta(profileDir, bundleName) {
  const base = path.join(profileDir, 'node_modules', ...bundleName.split('/'));
  const pkgPath = path.join(base, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return {
      id: bundleName,
      name: pkg.name || bundleName,
      version: pkg.version || '',
      description: String(pkg.description || '').split('\n')[0].slice(0, 160),
      isDshPlugin: Boolean(pkg.dsh?.bundle?.patch),
      installed: true
    };
  } catch {
    return { id: bundleName, name: bundleName, version: '', description: '（找不到 package.json）', isDshPlugin: false, installed: false };
  }
}

function listPlugins() {
  const prof = findProfileDir();
  if (!prof) return { ok: false, error: '找不到正在使用的 profile' };
  const bundles = Array.isArray(prof.pkg?.dsh?.profile?.bundles) ? prof.pkg.dsh.profile.bundles : [];
  const items = bundles.map((b) => {
    const meta = readPluginMeta(prof.dir, b);
    return { ...meta, enabled: true, protected: PROTECTED.has(b) };
  });
  return { ok: true, profile: path.basename(prof.dir), items, needsRestartHint: false };
}

/** 改 bundle 列表；只接受 JSON，且拒绝关闭受保护的包。 */
function setEnabled(bundleName, enabled) {
  const bundleNameClean = String(bundleName ?? '').trim();
  if (!bundleNameClean) return { ok: false, error: 'bundle 不能为空' };
  bundleName = bundleNameClean;
  const prof = findProfileDir();
  if (!prof) return { ok: false, error: '找不到正在使用的 profile' };
  if (PROTECTED.has(bundleName)) {
    return { ok: false, error: `${bundleName} 是核心插件，不允许关闭` };
  }
  const pkg = prof.pkg;
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
  const has = bundles.includes(bundleName);
  if (enabled && !has) bundles.push(bundleName);
  if (!enabled && has) {
    const i = bundles.indexOf(bundleName);
    bundles.splice(i, 1);
  }
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = bundles;
  try {
    fs.writeFileSync(prof.pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } catch (error) {
    return { ok: false, error: '写 profile 失败：' + (error?.message ?? error) };
  }
  log(`${enabled ? '启用' : '停用'} ${bundleName}（重启 DSH 后生效）`);
  return { ok: true, needsRestart: true };
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function apply(ctx) {
  const disposers = [];

  function guard(req, res) {
    // 同源 + DSH 会话鉴权：和其它插件一致，不额外发明 token。
    if (req.method !== 'GET') {
      const origin = String(req.headers.origin ?? '');
      const host = String(req.headers.host ?? '');
      if (origin && host && !origin.endsWith(host)) { sendJson(res, 403, { ok: false, error: '跨站请求被拒绝' }); return false; }
      if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
        sendJson(res, 415, { ok: false, error: '写操作必须是 application/json' }); return false;
      }
    }
    try {
      const conn = ctx.get('connection');
      if (conn && typeof conn.requestRejection === 'function') {
        const code = conn.requestRejection(req);
        if (code !== undefined && code !== null && code !== false) { res.statusCode = typeof code === 'number' ? code : 403; res.end(); return false; }
      }
    } catch { }
    return true;
  }

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/plugin-manager',
    handler: async (req, res) => {
      if (!guard(req, res)) return;
      try {
        const html = fs.readFileSync(UI_FILE, 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('ui.html 读不到：' + (error?.message ?? error));
      }
    }
  }));

  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/plugin-manager/api/',
    handler: async (req, res) => {
      if (!guard(req, res)) return;
      const url = new URL(req.url, 'http://127.0.0.1');
      try {
        if (req.method === 'GET' && url.pathname === '/plugin-manager/api/list') {
          const r = listPlugins();
          sendJson(res, r.ok ? 200 : 500, r);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/plugin-manager/api/toggle') {
          const raw = await readBody(req);
          let body;
          try { body = JSON.parse(raw || '{}'); } catch { sendJson(res, 400, { ok: false, error: 'body 不是合法 JSON' }); return; }
          const bundle = String(body.bundle ?? '').trim();
          if (!bundle) { sendJson(res, 400, { ok: false, error: 'bundle 不能为空' }); return; }
          const r = setEnabled(bundle, body.enabled === true);
          sendJson(res, r.ok ? 200 : 403, r);
          return;
        }
        sendJson(res, 404, { ok: false, error: 'not found' });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    }
  }));

  log('已注册 /plugin-manager');
  return () => { for (const d of disposers) { try { d?.(); } catch { } } };
}
