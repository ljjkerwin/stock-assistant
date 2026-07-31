# 小红书回复扩展

浏览器扩展源码位于 `extensions/xiaohongshu-reply-assistant/`，采用 Chrome / Edge Manifest V3。

- 扩展工具栏与管理页使用红色图标，位图资源位于 `icons/icon-{16,32,48,128}.png`；源文件为 `icons/icon.svg`。

- 匹配 `https://www.xiaohongshu.com/notification*` 与 `https://www.xiaohongshu.com/explore/*`，并在脚本中二次校验路径为 `/notification` 或 `/explore/` 及其子路径；`content.js` 以 `focusin` 和 `MutationObserver` 识别动态出现的两类回复输入框：通知评论列表的 `textarea.comment-input`，以及帖子弹窗的 `#content-textarea.content-input[contenteditable="true"]`。通知列表工具栏在输入框下方、`z-index` 为 1，并从当前通知项 `.container` 中优先读取 `.interaction-content`（用户留言正文），缺失时回退为整条通知文本；它注入 `document.body`。帖子弹窗工具栏在输入框左侧、`z-index` 为 21，其参考内容从 `.engage-bar .reply-content .content` 获取，并注入该输入框所属的 `.engage-bar.active`，使查询按钮被视作弹窗内部元素而不会触发外部失焦收起；工具栏以 `position: absolute; right: 100%` 相对弹窗工具栏容器展开，避免与输入框重叠。通知工具栏继续使用输入框的可视区域坐标固定定位；滚动、调整窗口或页面重渲染时会重算位置。两者都不占页面文档流。
- 「查询明暗盘数据」读取当前通知项文本及选择的日期，通过 Service Worker 访问股票助手的 `POST /api/darktrade/daily-result-from-text`。Service Worker 从扩展本地存储读取后端地址和 `xhs_` 插件访问令牌，并以 `Authorization: Bearer <token>` 请求，令牌不暴露给页面脚本，也不会发送给小红书。插件令牌由管理中心创建、只展示一次、可单独撤销，且只能访问此查询接口；每个令牌限制为每分钟 60 次。
- 查询按钮在自身的 `pointerdown`、`mousedown` 与 `click` 事件中阻止默认行为和冒泡，且不使用捕获监听，避免小红书将其判作弹窗外点击而关闭回复内容。106px 宽的紧凑日期选择框显示在按钮下方；查询状态不额外渲染提示或输出控制台日志。成功时，插件直接使用接口返回的后端统一 `summary` 写回回复框（例如 `名称，暗+0.23y，明-2.1y`，多个标的以 `；` 拼接并含随机后缀），随后触发原生 `input` 事件；不调用小红书的发表操作。
- 扩展设置提供生产/开发环境切换：默认生产 API 为 `https://stock.vdata.top/api`，开发环境为 `http://localhost:3100/api`；两个源均已写入 `manifest.json` 的 `host_permissions`。

安装步骤和当前限制见扩展目录的 `README.md`。

扩展图标点击后会打开设置弹窗，用于切换环境和填写插件访问令牌；设置保存在浏览器本地存储。
