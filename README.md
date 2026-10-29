# dsh-plugin-manager

DSH 的**插件管理器**：一个网页，列出当前 profile 里装的全部插件，每行一个开关。

> A tiny web-based plugin manager for DeepSeek Harness: list installed bundles, toggle them on/off.

## 它解决什么问题

DSH 的插件是写死在 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 里的。想临时关掉一个插件（比如省 token、排查冲突），以前只能手改 JSON 再重启。这个插件把它变成一个页面。

## 打开方式

装好并重启 DSH 后：

```
http://127.0.0.1:<DSH 端口>/plugin-manager
```

端口就是 DSH 运行时的那个（设置 → 浏览器与局域网 里能看到）。

## 两个刻意的设计

1. **开关不自动重启。**
   改完只写配置，页面提示「请手动重启 DSH」。自动重启会打断正在跑的会话和 QQ 桥接。

2. **核心插件不允许关闭。**
   `surfcore`（QQ 桥接本体）、`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、以及管理器自己，服务端会直接拒绝写请求，UI 上开关置灰。关掉它们 = DSH 或 QQ 直接瘫痪。

## 安装

```bash
git clone <repo> dsh-plugin-manager
cd dsh-plugin-manager
node scripts/install.mjs          # 或 --profile web / --dry-run
```

装完重启 DSH。

脚本做的事：把包**复制**进 `profiles/<profile>/node_modules/dsh-plugin-manager/`，并把 `dsh-plugin-manager` 加进 `dsh.profile.bundles`。

> 为什么是复制而不是链接：部分 Windows 环境不允许在 `node_modules` 里创建 junction/symlink（`Access denied`），复制最稳。

## 它能看见谁

`dsh.profile.bundles` 里的每一个 bundle，外加从各自 `package.json` 读到的版本与描述。以后新装的插件，只要进了 bundles 就会自动出现在列表里，不需要改这个插件。

## 卸载

从 `dsh.profile.bundles` 里删掉 `dsh-plugin-manager`，再删掉 `node_modules/dsh-plugin-manager/`，重启。

## 安全

- 只监听 DSH 自己的 Web 服务，走同一套会话鉴权（`connection.requestRejection`）；
- 写接口要求 `content-type: application/json` 且同源；
- 只改 `dsh.profile.bundles` 数组，不碰任何插件文件。

## License

MIT
