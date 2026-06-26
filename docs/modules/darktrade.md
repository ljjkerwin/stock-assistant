# 暗盘资金模块（DarkTrade）

> 本文档是 [AGENTS.md](../../AGENTS.md) 的卫星文档。改动暗盘抓取、索引或字段映射时**同步更新本文件**。接口行见 [docs/api.md 暗盘资金](../api.md#暗盘资金)。

---

## 工作机制

- K线总览页在加载时会自动携带客户端今日日期调用 `GET /api/darktrade/batch?codes=&date=YYYYMMDD`，后端检测到索引日期不匹配时自动触发全量刷新（爬取约 177 页 ~5300 只股票，约 5–10 秒），**无需手动运行脚本**
- 手动刷新仍可用 `node scripts/refresh-darktrade-index.mjs [YYYYMMDD]`（调用 `POST /api/darktrade/refresh-index`）
- `refresh-index` 建立 `code → (page, index)` 映射；`batch` / `:code` 通过该映射定位再取数；`date` 不匹配时 batch 端会在服务端用并发锁触发一次刷新（多请求只刷新一次）

## 暗盘快照（分时副图）

- 后端按交易时段定时抓取快照写入 `dark_trade_snapshots`（开盘前 09:30 之前的快照过滤不写入/不返回），形成**当日分钟粒度**的暗盘/明盘资金累计序列
- **收盘补点**：09:30–15:00 期间按抓取时的实际分钟打 `captureMinute`（最迟落在 14:5x，到不了 15:00）；**收盘后（北京时间 ≥15:00）再次拉取时，源数据已是当日收盘终值，会补写为 `${date}1500` 的 15:00 收盘快照**，填上 242 槽位横轴最后一槽。即只要收盘后再加载一次总览/详情页，当日就有完整到 15:00 的序列
- **股票详情页分时图**与 **K 线总览页**的暗盘副图均通过 `GET /api/darktrade/snapshots-batch?codes=&date=YYYYMMDD` 按**当日交易日**拉取分钟粒度快照。其中详情页的交易日由 `KLineChart` 加载 K 线后经 `onDateResolved` 上报「K 线实际交易日」（而非客户端日历日，规避周末/盘前不一致），父组件据此调 snapshots-batch 取 `Record[code]`
- 前端 `KLineChart` 暗盘副图：明盘正红/负绿、暗盘正浅红/负浅绿四条分时折线，横轴用 242 槽位（09:30–11:30 + 13:00–15:00，午休不画）与分时主图逐槽对齐，无快照的分钟留空
- `GET /api/darktrade/snapshots/:code?days=` 为**日粒度**历史快照（每日取最后一条），当前前端未使用，保留备用

## 数据源与编码

- 数据源：东方财富 `quotederivates.eastmoney.com/datacenter/darktrade`，支持 `date=YYYYMMDD` 参数
- 返回 **GBK 编码**，服务层用 `TextDecoder('gbk')` 解码，**无需额外安装 iconv-lite**

## 字段映射

| 键 | 含义 |
|----|------|
| `"6"` | 暗盘资金（元） |
| `"7"` | 明盘资金（元） |
| `"8"` | 主力净流入含暗盘（元） |
| `"11"` | 暗盘活跃度（小数） |
| `"13"` | 最新价 × 1000 |
| `"14"` | 涨幅（小数） |
| `"16"` | 名称 |
| `"17"` | 行业 |
| `"18"` | 概念 |
