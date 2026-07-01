# 监控模块（MonitorModule）

> 本文档是 [AGENTS.md](../../AGENTS.md) 的卫星文档。改动监控规则、轮询、SSE 或邮件通知时**同步更新本文件**。接口行见 [docs/api.md 监控](../api.md#监控)。

---

- 规则触发时，除写入消息表并推送 SSE 外，还通过 `EmailService` 向配置的收件人发送邮件通知；发送为异步 fire-and-forget，失败时只记录日志，不影响主流程
- 邮件通过 163 SMTP（smtp.163.com:465）发送，凭证通过环境变量配置：`EMAIL_USER`（发件人）、`EMAIL_PASS`（163 SMTP 授权码）、`EMAIL_TO`（收件人，默认 ljjnotice@163.com）；未配置时邮件功能自动禁用
- 参考 `backend/.env.example` 创建 `backend/.env` 文件填写凭证
- 后端 `MonitorService` 在 `OnModuleInit` 启动 60s 定时轮询；外层守卫用 `isTrading()`（任意市场开盘即进入），内层按股票市场调用 `isTradingMarket(market)` 过滤，非交易时段的规则静默跳过（无任何日志）
- 规则检查：价格规则直接对比当前价；MA 均线穿越规则使用**边沿触发**（`prevAboveMA` 字段记录上次方向），避免持续满足时重复触发
- MA 均线穿越规则支持日线（`klinePeriod=null`）、15min（`klinePeriod='15min'`）、5min（`klinePeriod='5min'`）、30min（`klinePeriod='30min'`）和 60min（`klinePeriod='60min'`）等 K 线周期；`maPeriod` 支持 `ma5 | ma10 | ma20 | ma60`；轮询时按 `klinePeriod` 分组拉取 K 线，同一股票的不同周期规则各自复用对应缓存
- 每条规则每 30 分钟最多触发一次（`lastTriggeredAt` + `COOLDOWN_MS = 30 * 60_000`）
- 触发后写入 `monitor_messages` 表，并通过 RxJS `Subject` 推送 SSE 事件至前端
- MA 均线穿越规则重新激活时，`prevAboveMA` 重置为 null，下次轮询重新初始化方向
- 轮询日志格式：`[轮询] 开始检查，共 N 条活跃规则` / `[轮询] 规则 #id 触发 ...` / `[轮询] 完成，触发 N 条规则`

## 前端

- 前端 `useMonitorSSE` hook 通过 `EventSource(/api/monitor/events)` 接收推送，写入 `monitorStore`
- `MonitorCenter` 组件固定在页面左下角（sidebar 宽度范围内居中），弹窗采用 Tabs 结构，包含「消息通知」与「监控规则」两个标签页。「消息通知」展示触发的历史消息，支持点击股票名跳转，消息分页加载（每页 20 条，已读/未读均可翻页），`getMessages` 不标记已读；每次加载完一页后，store 内自动提取本页未读 ID 调用 `PATCH /api/monitor/messages` 批量标记已读并刷新未读角标；未读角标通过独立接口 `getUnreadCount` 维护，SSE 推送到达时立即 +1。 「监控规则」展示全局所有活跃/暂停的监控规则，支持快捷切换启用状态、删除规则以及点击股票名跳转。
- `StockMonitorButton` 组件嵌入各股票详情页标题栏右侧，Badge 显示该股票活跃规则数；弹窗展示并管理该股票的监控规则（增删、激活/暂停），添加规则无需选择股票（已由页面上下文确定）

## 调试

- 轮询日志通过 NestJS `Logger(MonitorService.name)` 输出，搜索 `[轮询]` 前缀。手动验证规则：`curl -X GET http://localhost:3100/api/monitor/rules`，重启服务后首次开盘轮询自动开始
- 配置邮件：复制 `backend/.env.example` 为 `backend/.env`，填入 163 邮箱账号和 SMTP 授权码。邮件日志搜索 `[邮件]` 前缀；未配置时后端启动日志会打印 `EMAIL_USER 或 EMAIL_PASS 未配置，邮件通知已禁用`
