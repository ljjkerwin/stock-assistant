# 暗盘资金模块（DarkTrade）

> 本文档是 [AGENTS.md](../../AGENTS.md) 的卫星文档。改动暗盘抓取、索引或字段映射时**同步更新本文件**。接口行见 [docs/api.md 暗盘资金](../api.md#暗盘资金)。

---

## 工作机制

- K线总览页在加载时会自动携带客户端今日日期调用 `GET /api/darktrade/batch?codes=&date=YYYYMMDD`，后端检测到索引日期不匹配时自动触发全量刷新（爬取约 177 页 ~5300 只股票，约 5–10 秒），**无需手动运行脚本**
- 手动刷新仍可用 `node scripts/refresh-darktrade-index.mjs [YYYYMMDD]`（调用 `POST /api/darktrade/refresh-index`）
- `refresh-index` 建立 `code → (page, index)` 映射；`batch` / `:code` 通过该映射定位再取数；`date` 不匹配时 batch 端会在服务端用并发锁触发一次刷新（多请求只刷新一次）

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
