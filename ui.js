// 悬浮入口：由 index.js 通过 webserver/index-inject（桌面端）或 tapIndex（网页端）
// 注入到 DSH 页面里。
//
// 设计要点（踩过的坑）：
//   · **不用 iframe**：DSH 的响应可能带 frame-ancestors/X-Frame-Options，iframe 会空白。
//     这里直接 fetch /plugin-manager/api/* 并自己渲染列表。
//   · **全屏浮层 + 自己滚动**：面板用 position:fixed; inset:0 铺满视口，
//     卡片 max-height 80vh 且内部 overflow:auto —— 不依赖宿主的高度，不会再"跑到底下去"。
//   · 左下角按钮避开右下角的小鲸鱼挂件。
(function () {
  if (window.__dshPluginManagerMounted) return;
  window.__dshPluginManagerMounted = true;

  var ID = 'dsh-pm';
  var PROTECTED_HINTS = {
    'surfcore': 'QQ 桥接本体，关掉她就不回话了',
    'dsh-plugin-manager': '就是本面板',
    '@deepseek-ai/dsh-base': 'DSH 基础层',
    '@deepseek-ai/dsh-web-app': 'DSH 网页端'
  };

  function ensureCss() {
    if (document.getElementById(ID + '-style')) return;
    var s = document.createElement('style');
    s.id = ID + '-style';
    s.textContent = [
      '#' + ID + '-btn{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:6px;',
      'padding:7px 12px;border-radius:999px;border:1px solid rgba(127,127,127,.35);',
      'background:rgba(24,26,32,.88);color:#e6e9ef;font:12.5px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
      'cursor:pointer;backdrop-filter:blur(8px);box-shadow:0 4px 14px rgba(0,0,0,.28);user-select:none}',
      '#' + ID + '-btn:hover{border-color:rgba(127,127,127,.65)}',
      '#' + ID + '-mask{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483001;background:rgba(0,0,0,.45);',
      'display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}',
      '#' + ID + '-card{width:min(880px,100%);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;',
      'background:#171a21;color:#e6e9ef;border:1px solid #262b36;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.5);',
      'font:13px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}',
      '#' + ID + '-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #262b36}',
      '#' + ID + '-head b{font-size:15px}',
      '#' + ID + '-head span{color:#8b93a3;font-size:12px;flex:1}',
      '#' + ID + '-close{border:0;background:rgba(255,255,255,.1);color:#e6e9ef;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:15px;line-height:1}',
      '#' + ID + '-list{overflow:auto;flex:1;min-height:0}',
      '#' + ID + '-list .row{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-top:1px solid #20242d}',
      '#' + ID + '-list .row:first-child{border-top:0}',
      '#' + ID + '-list .meta{flex:1;min-width:0}',
      '#' + ID + '-list .nm{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-weight:600}',
      '#' + ID + '-list .ver{color:#8b93a3;font-weight:400;font-size:12px}',
      '#' + ID + '-list .ds{color:#8b93a3;font-size:12.5px;margin-top:2px}',
      '#' + ID + '-list .bg{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid #2f3542;color:#9aa3b2}',
      '#' + ID + '-list .bg.lock{color:#f0a441;border-color:rgba(240,164,65,.4)}',
      '#' + ID + '-list .bg.core{color:#4b6fff;border-color:rgba(75,111,255,.4)}',
      '#' + ID + '-list .sw{position:relative;width:42px;height:23px;flex:none;margin-top:3px}',
      '#' + ID + '-list .sw input{opacity:0;width:0;height:0}',
      '#' + ID + '-list .sw i{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:999px;background:#2f3542;cursor:pointer;transition:.18s}',
      '#' + ID + '-list .sw i:after{content:"";position:absolute;width:17px;height:17px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.18s}',
      '#' + ID + '-list .sw input:checked + i{background:#3fbf7f}',
      '#' + ID + '-list .sw input:checked + i:after{transform:translateX(19px)}',
      '#' + ID + '-list .sw input:disabled + i{opacity:.45;cursor:not-allowed}',
      '#' + ID + '-tip{padding:10px 16px;border-top:1px solid #262b36;color:#f0a441;font-size:12px;display:none}',
      '#' + ID + '-tip.on{display:block}',
      '#' + ID + '-err{padding:10px 16px;color:#e5534b;font-size:12px;display:none}',
      '#' + ID + '-err.on{display:block}'
    ].join('');
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function rowHtml(it) {
    var locked = it.protected === true;
    var hint = PROTECTED_HINTS[it.id];
    var badges = (locked ? '<span class="bg lock">受保护</span>' : '')
      + (hint && !locked ? '<span class="bg core">' + esc(hint) + '</span>' : '');
    var desc = it.summary || it.description || '（这个插件没有写说明）';
    return '<div class="row"><div class="meta">'
      + '<div class="nm">' + esc(it.name) + ' <span class="ver">' + esc(it.version || '') + '</span> ' + badges + '</div>'
      + '<div class="ds">' + esc(desc) + '</div>'
      + '</div><label class="sw"><input type="checkbox" ' + (it.enabled ? 'checked' : '')
      + (locked ? ' disabled' : '') + ' data-bundle="' + esc(it.id) + '"><i></i></label></div>';
  }

  function closePanel() {
    var m = document.getElementById(ID + '-mask');
    if (m) m.remove();
  }

  function toggle(el, tip, err) {
    var bundle = el.getAttribute('data-bundle');
    var enabled = el.checked;
    el.disabled = true;
    fetch('/plugin-manager/api/toggle', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundle: bundle, enabled: enabled })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.error || '保存失败');
      tip.className = 'on';
      err.className = '';
    }).catch(function (e) {
      el.checked = !enabled;
      err.textContent = '保存失败：' + e.message;
      err.className = 'on';
    }).then(function () { el.disabled = false; });
  }

  function openPanel() {
    if (document.getElementById(ID + '-mask')) return;
    ensureCss();
    var mask = document.createElement('div');
    mask.id = ID + '-mask';
    mask.innerHTML = '<div id="' + ID + '-card">'
      + '<div id="' + ID + '-head"><b>插件管理器</b><span>开关只改配置，需手动重启 DSH 生效</span>'
      + '<button id="' + ID + '-close" title="关闭">×</button></div>'
      + '<div id="' + ID + '-list">正在读取…</div>'
      + '<div id="' + ID + '-tip">已保存。请手动重启 DSH 让改动生效。</div>'
      + '<div id="' + ID + '-err"></div>'
      + '</div>';
    document.body.appendChild(mask);

    document.getElementById(ID + '-close').onclick = closePanel;
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) closePanel(); });
    document.addEventListener('keydown', function escKey(e) {
      if (e.key === 'Escape') closePanel();
    });

    var list = document.getElementById(ID + '-list');
    var tip = document.getElementById(ID + '-tip');
    var err = document.getElementById(ID + '-err');

    fetch('/plugin-manager/api/list', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || '读取失败');
        if (!j.items || !j.items.length) { list.innerHTML = '这个 profile 还没有装任何插件。'; return; }
        list.innerHTML = j.items.map(rowHtml).join('');
        Array.prototype.forEach.call(list.querySelectorAll('input[type=checkbox]'), function (el) {
          el.addEventListener('change', function () { toggle(el, tip, err); });
        });
      })
      .catch(function (e) {
        list.innerHTML = '';
        err.textContent = '读取失败：' + e.message;
        err.className = 'on';
      });
  }

  function mount() {
    if (document.getElementById(ID + '-btn')) return;
    ensureCss();
    var btn = document.createElement('button');
    btn.id = ID + '-btn';
    btn.type = 'button';
    btn.textContent = '⚙ 插件';
    btn.title = '插件管理器：查看/开关已安装的插件';
    btn.onclick = openPanel;
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  setTimeout(mount, 1500);
})();
