# 小红书回复扩展

浏览器扩展源码位于 `extensions/xiaohongshu-reply-assistant/`，采用 Chrome / Edge Manifest V3。

- 扩展工具栏与管理页使用红色图标，位图资源位于 `icons/icon-{16,32,48,128}.png`；源文件为 `icons/icon.svg`。

- 仅匹配 `https://www.xiaohongshu.com/notification*`，并在脚本中二次校验路径为 `/notification`；`content.js` 以 `focusin` 和 `MutationObserver` 识别动态出现的回复输入框。检索时从回复框向上定位当前通知项 `.container`，再优先读取其中的 `.interaction-content`（用户留言正文），仅在该节点缺失时回退为整条通知文本。工具栏以 Shadow DOM 注入到 `document.body`，以输入框的可视区域坐标固定定位；滚动、调整窗口或页面重渲染时会重算位置。它不占页面文档流、不顶开后续通知项，也不会被回复容器的 `overflow` 裁掉；`z-index` 为 1，使小红书原生弹窗可覆盖它。
- 「查找明暗盘数据」读取当前通知项文本及选择的日期，通过 Service Worker 访问股票助手的 `POST /api/darktrade/daily-result-from-text`。Service Worker 从扩展本地存储读取后端地址和 `xhs_` 插件访问令牌，并以 `Authorization: Bearer <token>` 请求，令牌不暴露给页面脚本，也不会发送给小红书。插件令牌由管理中心创建、只展示一次、可单独撤销，且只能访问此查询接口；每个令牌限制为每分钟 60 次。
- 成功时，插件按管理中心同一口径格式化为 `名称，暗+0.23y，明-2.1y`，多个标的以 `；` 拼接，并触发原生 `input` 事件写回回复框；不调用小红书的发表操作。
- 扩展设置提供生产/开发环境切换：默认生产 API 为 `https://stock.vdata.top/api`，开发环境为 `http://localhost:3100/api`；两个源均已写入 `manifest.json` 的 `host_permissions`。

安装步骤和当前限制见扩展目录的 `README.md`。

扩展图标点击后会打开设置弹窗，用于切换环境和填写插件访问令牌；设置保存在浏览器本地存储。
