# API 接口一览

> 本文档是 [AGENTS.md](../AGENTS.md) 的卫星文档。**新增接口、字段、枚举值时同步更新本文件**；AGENTS.md 不再保留完整接口表，仅指向此处。
>
> 所有后端 Controller 的路由前缀必须包含 `api/`（如 `@Controller('api/fund')`），不使用 NestJS 全局前缀，否则 Vite 代理无法转发。

通用枚举：

- `market`：`A`（A股 + 场内ETF）/ `HK`（港股）
- `period`：`timeshare` `1min` `5min` `15min` `30min` `60min` `daily` `weekly`

---

## 收藏夹 / 标的列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/favorites?watchListId=` | 获取指定列表的收藏（`watchListId` 必需，pinned desc, sort_order asc） |
| POST | `/api/favorites` | 添加收藏（body `{ code, market, name, watchListId }`，`watchListId` 必需；market 与列表板块不匹配时返回 400） |
| DELETE | `/api/favorites/:id` | 删除收藏 |
| PATCH | `/api/favorites/:id` | 更新排序 / 置顶状态 |
| GET | `/api/watchlists?boardType=stock\|fund` | 获取该板块的标的列表（`isDefault` 列表「收藏夹」排最前，其余按创建时间升序） |
| POST | `/api/watchlists` | 新建自定义标的列表，body `{ name, boardType }` |
| DELETE | `/api/watchlists/:id` | 删除标的列表（默认列表「收藏夹」不可删，返回 400；级联删除列表内的收藏） |

## 股票 / K线

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stocks/search?q=` | 按代码或名称搜索（A股 + 港股） |
| GET | `/api/stocks/:market/:code` | 获取股票基本信息 |
| GET | `/api/kline/:market/:code?period=` | 获取 K 线数据 |

## 监控

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/monitor/rules` | 获取所有监控规则 |
| POST | `/api/monitor/rules` | 创建监控规则 |
| DELETE | `/api/monitor/rules/:id` | 删除监控规则 |
| PATCH | `/api/monitor/rules/:id` | 切换规则激活状态（`{ active: boolean }`） |
| GET | `/api/monitor/messages?page=` | 获取触发消息列表（分页，每页 20 条，已读/未读均可翻页，不改变已读状态） |
| GET | `/api/monitor/messages/unread-count` | 获取未读消息数 `{ count }` |
| PATCH | `/api/monitor/messages` | 批量标记已读，`{ ids: number[] }` 指定消息 ID |
| DELETE | `/api/monitor/messages` | 清空所有消息 |
| GET (SSE) | `/api/monitor/events` | SSE 实时推送触发事件 |

## 基金

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/fund/search?q=` | 基金代码/名称搜索（东方财富 fundsuggest，最多 10 条） |
| GET | `/api/fund/:code` | 获取基金基本信息 + 最新净值 + 实时估值 |
| GET | `/api/fund/:code/nav?limit=` | 获取基金历史净值数据（默认 120 条，最多 1000） |
| GET | `/api/fund/:code/holdings` | 获取基金最近两期前10大持仓股（季报） |

## 策略回测

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/strategy/list` | 策略清单（返回 `{ id, name }[]`，`id` 为稳定标识、`name` 为可变展示名） |
| GET | `/api/strategy/backtest?market=&code=&startDate=&endDate=&period=&strategy=` | 策略回测（返回回测结果、K线数据、交易信号） |

`strategy` 取**策略 id**（稳定标识，非展示名；展示名可改而 id 不变）。当前可用：`trend2` / `trend5` / `trend8` / `pullback15`，各策略定位与设计详见 [docs/strategies.md](./strategies.md)。可用策略及展示名以 `GET /api/strategy/list` 为准。

## 暗盘资金

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/darktrade/index-status` | 查询暗盘索引状态 `{ count, date, updatedAt }` |
| POST | `/api/darktrade/refresh-index` | 抓取所有页暗盘数据并建立 code→(page,index) 映射（body 可选 `{ date?, sortFlag?, desc? }`，默认按暗盘资金降序 sortFlag=6） |
| GET | `/api/darktrade/batch?codes=&date=` | 批量查询多只股票的暗盘资金数据，`codes` 为逗号分隔的代码列表，返回 `Record<code, DarkTradeData>`（不在索引中的代码静默忽略）；可选 `date=YYYYMMDD`，传入时若当前索引日期不匹配则**自动触发 refresh-index**（服务端并发锁，多请求只刷新一次），无需手动脚本 |
| GET | `/api/darktrade/:code` | 通过映射查询指定股票的暗盘资金数据，返回 `DarkTradeData`（需先 refresh-index） |

字段映射与使用说明详见 [docs/modules/darktrade.md](./modules/darktrade.md)。
