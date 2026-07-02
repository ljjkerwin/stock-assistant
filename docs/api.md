# API 接口一览

> 本文档是 [AGENTS.md](../AGENTS.md) 的卫星文档。**新增接口、字段、枚举值时同步更新本文件**；AGENTS.md 不再保留完整接口表，仅指向此处。
>
> 所有后端 Controller 的路由前缀必须包含 `api/`（如 `@Controller('api/fund')`），不使用 NestJS 全局前缀，否则 Vite 代理无法转发。

通用枚举：

- `market`：`A`（A股 + 场内ETF）/ `HK`（港股）
- `period`：`timeshare` `1min` `5min` `15min` `30min` `60min` `daily` `weekly`

**鉴权**：除 `POST /api/auth/login` 外，**所有 `/api/*` 接口都需要登录令牌**。令牌通过请求头 `Authorization: Bearer <token>` 传递；SSE（`EventSource` 无法自定义请求头）改用 query 参数 `?token=<token>`。缺失/无效/过期令牌一律返回 `401`。前端 axios 拦截器自动附带令牌，收到 401 时清除本地令牌并退回登录页。

---

## 鉴权（auth）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录（**公开**），body `{ username, password }`，成功返回 `{ token, user: { id, username } }`；用户名或密码错误返回 401 |
| GET | `/api/auth/me` | 返回当前登录用户 `{ id, username }`（凭令牌） |

> 令牌为精简版 JWT（HMAC-SHA256 签名，含 `sub`/`username`/`exp`，默认 7 天有效），密钥取环境变量 `AUTH_SECRET`（缺省有开发兜底值）。密码用 scrypt 加盐哈希存储。首次启动自动种入内置账号 `ljj`，并把历史无归属的标的列表/收藏归到该账号下。

---

## 收藏夹 / 标的列表

> 标的列表归属用户：`watch_lists` 增加 `user_id` 列，下列接口均**按当前登录用户隔离**，仅能读写自己名下的列表与收藏；访问他人列表/收藏返回 404。

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
| GET | `/api/stocks/batch?symbols=` | 批量查询多只股票的基本详情，`symbols` 为逗号分隔的 `market:code` 列表，返回 `Record<market:code, StockInfo>` |
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
| POST | `/api/darktrade/refresh-index` | 抓取所有页暗盘数据并建立 code→(page,index) 映射（body 可选 `{ date?, sortFlag?, desc? }`，默认按股票名称 Unicode 降序 sortFlag=4） |
| GET | `/api/darktrade/batch?codes=&date=` | 【已废弃，前端已改用 snapshots-batch】批量查询多只股票的暗盘资金数据 |
| GET | `/api/darktrade/:code` | 通过映射查询指定股票的暗盘资金数据，返回 `DarkTradeData`（需先 refresh-index） |
| GET | `/api/darktrade/snapshots/:code?days=` | 单只股票的历史暗盘快照（**日粒度**：每个交易日取当日最后一条，默认 60 天），返回 `DarkTradeSnapshot[]`，`time` 为 `YYYY-MM-DD` |
| GET | `/api/darktrade/snapshots-batch?codes=&date=` | 批量暗盘快照（**分钟粒度**），`codes` 逗号分隔；传 `date=YYYYMMDD` 时只取当天。若 `date` 不匹配，**自动在服务端并发锁中触发 refresh-index** 进行全量刷新。股票详情页与 K 线总览页均用此接口，K 线总览页右上角最新明暗盘数据也会直接从该快照列表的最后一根中提取渲染。 |

字段映射与使用说明详见 [docs/modules/darktrade.md](./modules/darktrade.md)。
