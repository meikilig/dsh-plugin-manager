// 悬浮入口：由 index.js 通过 webserver/index-inject（桌面端）或 tapIndex（网页端）
// 注入到 DSH 页面里。它只做一件事：在界面左下角放一个「插件」按钮，点开一个面板，
// 面板里是 iframe（/plugin-manager 页面本身），这样开关逻辑只有一份。
//
// 为什么不直接操作 DSH 的 React 侧栏：那依赖宿主内部的 class 名和状态树，
// 版本一变就坏；悬浮按钮只依赖 document.body，稳得多。
(function () {
  if (window.__dshPluginManagerMounted) return;
  window.__dshPluginManagerMounted = true;

  var BTN_ID = 'dsh-plugin-manager-btn';
  var MASK_ID = 'dsh-plugin-manager-mask';

  function css() {
    if (document.getElementById('dsh-pm-style')) return;
    var s = document.createElement('style');
    s.id = 'dsh-pm-style';
    s.textContent = [
      '#' + BTN_ID + '{position:fixed;left:14px;bottom:14px;z-index:2147483000;display:flex;align-items:center;gap:6px;',
      'padding:7px 12px;border-radius:999px;border:1px solid rgba(127,127,127,.35);',
      'background:rgba(24,26,32,.86);color:#e6e9ef;font:12.5px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
      'cursor:pointer;backdrop-filter:blur(8px);box-shadow:0 4px 14px rgba(0,0,0,.28);user-select:none;transition:.15s}',
      '#' + BTN_ID + ':hover{transform:translateY(-1px);border-color:rgba(127,127,127,.6)}',
      '#dsh-pm-mask{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.42);display:flex;',
      'align-items:center;justify-content:center;padding:24px}',
      '#dsh-pm-frame{width:min(900px,100%);height:min(640px,100%);border:1px solid rgba(127,127,127,.35);',
      'border-radius:14px;background:#0f1115;box-shadow:0 18px 50px rgba(0,0,0,.5);overflow:hidden}',
      '#dsh-pm-close{position:absolute;top:18px;right:22px;width:30px;height:30px;border-radius:50%;border:0;',
      'background:rgba(255,255,255,.12);color:#fff;font-size:16px;line-height:1;cursor:pointer}',
      '@media (prefers-color-scheme: light){#' + BTN_ID + '{background:rgba(255,255,255,.92);color:#1c2128}}'
    ].join('');
    document.head.appendChild(s);
  }

  function openPanel() {
    if (document.getElementById(MASK_ID)) return;
    var mask = document.createElement('div');
    mask.id = MASK_ID;
    var frame = document.createElement('iframe');
    frame.id = 'dsh-pm-frame';
    frame.src = '/plugin-manager';
    var close = document.createElement('button');
    close.id = 'dsh-pm-close';
    close.textContent = '×';
    close.title = '关闭';
    close.onclick = function () { mask.remove(); };
    mask.onclick = function (e) { if (e.target === mask) mask.remove(); };
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { mask.remove(); document.removeEventListener('keydown', esc); }
    });
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center';
    wrap.appendChild(frame);
    mask.appendChild(wrap);
    mask.appendChild(close);
    document.body.appendChild(mask);
  }

  function mount() {
    if (document.getElementById(BTN_ID)) return;
    css();
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '⚙ 插件';
    btn.title = '插件管理器：查看/开关已安装的插件';
    btn.onclick = openPanel;
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
  // 有些宿主会重建 body（比如切换页面），补一次挂载
  setTimeout(mount, 1500);
})();
