# AGENTS.md — 股票助手

AI 编码代理的协作指南，帮助快速理解本项目并高效完成任务。

---

## 项目概述

个人股票助手，支持 A股 + 港股的收藏管理与 K 线行情查看。

- **前端**：React 19 + Vite + TypeScript + Ant Design + Lightweight Charts (TradingView) + Zustand
- **后端**：NestJS + TypeORM + MySQL（可选，未配置时回退 SQLite）
- **数据源**：东方财富（搜索 + 行情）、新浪财经（A股/ETF K线）、Yahoo Finance（港股K线）

---

## 目录结构

```
stock-assistant/
├── frontend/src/
│   ├── components/
│   │   ├── Sidebar/             # 左侧面板（顶端 Select 切换股票/基金模式）
│   │   ├── KLineChart/          # K线图公共组件（封装 Lightweight Charts）
│   │   ├── NavChart/            # 基金净值折线图组件（封装 Lightweight Charts）
│   │   ├── StockSearch/         # 股票搜索组件
│   │   ├── FundSearch/          # 基金搜索组件
│   │   └── StockMonitorButton/  # 个股监控规则按钮（嵌入详情页标题栏）
│   ├── pages/
│   │   ├── Home/           # 首页（暂空）
│   │   ├── StockDetail/    # 股票详情页
│   │   └── FundDetail/     # 基金详情页（路由 /fund/:code）
│   ├── store/
│   │   └── favoritesStore.ts  # Zustand 全局状态
│   ├── api/
│   │   └── stock.ts           # 所有后端 API 请求封装
│   └── types/                 # TypeScript 类型定义
└── backend/src/
    ├── stocks/                # 股票搜索 + 基本信息接口
    ├── kline/                 # K线数据接口（统一封装多市场数据源）
    ├── fund/                  # 基金净值接口（东方财富 lsjz + 实时估值）
    ├── favorites/             # 收藏夹 CRUD + SQLite 实体
    ├── cache.ts               # MemCache + 交易时段感知 TTL
    ├── app.module.ts
    └── main.ts
```

---

## 启动开发环境

```bash
# 后端（端口 3000）
cd backend
pnpm install
pnpm start:dev

# 前端（端口 5173，/api 代理到 3000）
cd frontend
pnpm install
pnpm dev

```

---

## API 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/favorites` | 获取收藏列表（pinned desc, sort_order asc） |
| POST | `/api/favorites` | 添加收藏 |
| DELETE | `/api/favorites/:id` | 删除收藏 |
| PATCH | `/api/favorites/:id` | 更新排序 / 置顶状态 |
| GET | `/api/stocks/search?q=` | 按代码或名称搜索（A股 + 港股） |
| GET | `/api/stocks/:market/:code` | 获取股票基本信息 |
| GET | `/api/kline/:market/:code?period=` | 获取 K 线数据 |
| GET | `/api/monitor/rules` | 获取所有监控规则 |
| POST | `/api/monitor/rules` | 创建监控规则 |
| DELETE | `/api/monitor/rules/:id` | 删除监控规则 |
| PATCH | `/api/monitor/rules/:id` | 切换规则激活状态（`{ active: boolean }`） |
| GET | `/api/monitor/messages?page=` | 获取触发消息列表（分页，每页 20 条，已读/未读均可翻页，不改变已读状态） |
| GET | `/api/monitor/messages/unread-count` | 获取未读消息数 `{ count }` |
| PATCH | `/api/monitor/messages` | 批量标记已读，`{ ids: number[] }` 指定消息 ID |
| DELETE | `/api/monitor/messages` | 清空所有消息 |
| GET (SSE) | `/api/monitor/events` | SSE 实时推送触发事件 |
| GET | `/api/fund/search?q=` | 基金代码/名称搜索（东方财富 fundsuggest，最多 10 条） |
| GET | `/api/fund/:code` | 获取基金基本信息 + 最新净值 + 实时估值 |
| GET | `/api/fund/:code/nav?limit=` | 获取基金历史净值数据（默认 120 条，最多 1000） |

`market` 取值：`A`（A股 + 场内ETF）/ `HK`（港股）

`period` 枚举：`timeshare` `1min` `5min` `15min` `30min` `60min` `daily` `weekly`

---

## 关键设计约定

### K线图（`KLineChart` 组件）
- 分时图渲染折线图，其他周期渲染蜡烛线
- 副图包含成交量（柱状图，涨红跌绿）和 MACD(4,35,4)
- MACD 由**后端计算**后随 K 线数据一并返回，前端不做指标计算
- 三个图（主图、量图、MACD 图）各有 legend，鼠标在任意图区移动时三者同步更新；`applyData` 将 bars 存入 `barsRef`，`updateAllLegends(time)` 按时间查表统一刷新
- 30 秒轮询刷新，仅在对应市场交易时段内启用

### 后端 `KlineService`
- 屏蔽 A股/ETF/港股数据源差异：A股和场内ETF K线用新浪财经 API，港股 K线用 Yahoo Finance API
- 新浪 symbol 前缀规则：`6` 或 `5` 开头用 `sh`（沪市，含 ETF 51xxxx 系列），其余用 `sz`（深市，含 ETF 15xxxx 系列）
- 东方财富 secid 前缀规则：同上，`6` 或 `5` 开头前缀为 `1`，其余为 `0`
- 新增市场只需在 `KlineService` 内新增 `fetch*` 方法，上层接口不变

### 缓存层（`cache.ts`）
- `MemCache<T>`：进程内 TTL 缓存，自动过期，无需外部依赖
- `isTradingMarket(market)`：按市场判断当前是否在交易时段；A股 09:30–11:30、13:00–15:00；HK 09:30–12:00、13:00–16:00
- `isTrading()`：任意市场在交易时段内即返回 true，用于缓存 TTL 守卫（覆盖 HK 最宽窗口 09:30–12:00、13:00–16:00）
- `tradingTtl(tradingMs, offHoursMs)`：交易时段返回短 TTL，盘外返回长 TTL
- K线缓存 TTL：分时/1min 盘中 1min，5min–30min 盘中 3min，60min/日线盘中 5min，周线盘中 10min；**盘外统一 1h**
- 行情缓存 TTL：盘中 30s，盘外 10min

### 监控模块（`MonitorModule`）
- 规则触发时，除写入消息表并推送 SSE 外，还通过 `EmailService` 向配置的收件人发送邮件通知；发送为异步 fire-and-forget，失败时只记录日志，不影响主流程
- 邮件通过 163 SMTP（smtp.163.com:465）发送，凭证通过环境变量配置：`EMAIL_USER`（发件人）、`EMAIL_PASS`（163 SMTP 授权码）、`EMAIL_TO`（收件人，默认 ljjnotice@163.com）；未配置时邮件功能自动禁用
- 参考 `backend/.env.example` 创建 `backend/.env` 文件填写凭证
- 后端 `MonitorService` 在 `OnModuleInit` 启动 30s 定时轮询；外层守卫用 `isTrading()`（任意市场开盘即进入），内层按股票市场调用 `isTradingMarket(market)` 过滤，非交易时段的规则静默跳过（无任何日志）
- 规则检查：价格规则直接对比当前价；MA 均线穿越规则使用**边沿触发**（`prevAboveMA` 字段记录上次方向），避免持续满足时重复触发
- MA 均线穿越规则支持日线（`klinePeriod=null`）和 15min（`klinePeriod='15min'`）两个 K 线周期；`maPeriod` 支持 `ma5 | ma10 | ma20 | ma60`；轮询时按 `klinePeriod` 分组拉取 K 线，同一股票的不同周期规则各自复用对应缓存
- 每条规则每 2 小时最多触发一次（`lastTriggeredAt` + `COOLDOWN_MS = 2 * 60 * 60_000`）
- 触发后写入 `monitor_messages` 表，并通过 RxJS `Subject` 推送 SSE 事件至前端
- MA 均线穿越规则重新激活时，`prevAboveMA` 重置为 null，下次轮询重新初始化方向
- 轮询日志格式：`[轮询] 开始检查，共 N 条活跃规则` / `[轮询] 规则 #id 触发 ...` / `[轮询] 完成，触发 N 条规则`
- 前端 `useMonitorSSE` hook 通过 `EventSource(/api/monitor/events)` 接收推送，写入 `monitorStore`
- `MonitorCenter` 组件固定在页面左下角（sidebar 宽度范围内居中），弹窗仅展示「消息通知」列表，不再包含监控规则管理；消息分页加载（每页 20 条，已读/未读均可翻页），`getMessages` 不标记已读；每次加载完一页后，store 内自动提取本页未读 ID 调用 `PATCH /api/monitor/messages` 批量标记已读并刷新未读角标；未读角标通过独立接口 `getUnreadCount` 维护，SSE 推送到达时立即 +1
- `StockMonitorButton` 组件嵌入各股票详情页标题栏右侧，Badge 显示该股票活跃规则数；弹窗展示并管理该股票的监控规则（增删、激活/暂停），添加规则无需选择股票（已由页面上下文确定）

### 基金模块（`FundModule`）
- 路由：`/fund/:code`，`code` 为基金代码（如 `000001`），无 market 参数
- 搜索数据源：东方财富 `fundsuggest.eastmoney.com` API，结果缓存 5min
- 净值数据源：东方财富 `lsjz` API（历史净值）+ `fundgz.1234567.com.cn` JSONP API（实时估值）
- 两个接口并发请求，任一失败均降级处理（估值不可用时不展示估值字段）
- 历史净值接口返回最新在前，`FundService` 反转为时间正序供图表使用
- Sidebar 顶端 Select 切换股票/基金模式，模式由当前 URL 路径决定（`/fund/*` → 基金模式，其余 → 股票模式）；切换时分别导航到 `/stock` 或 `/fund`；`/` 重定向到 `/stock`
- `NavChart` 组件：Lightweight Charts 折线图，展示单位净值（蓝色）和累计净值（橙色）两条线；时间区间通过 `limit` 参数控制（1M=25/3M=70/6M=135/1Y=255/3Y=760/ALL=1000）
- 缓存 TTL：`getFundInfo` 盘中 30s，盘外 10min；`getFundNav` 盘中 1min，盘外 1h

### 状态管理（Zustand）
- 收藏列表和当前选中股票均通过 `favoritesStore` 管理
- 监控规则和消息通过 `monitorStore` 管理，规则数据从后端 API 获取（不用 localStorage）
- 组件不直接调用 API，通过 store action 触发请求

---

## 常见任务指引

**新增一个 API 字段**：先改 `backend/src/stocks/stocks.service.ts` 中的数据映射，再更新 `frontend/src/types/` 中对应的 TypeScript 类型。

**新增 K 线周期**：在后端 `KlineService` 的 period 映射中添加枚举值，同时在前端 `KLineChart` 的 TAB 配置中添加对应选项。

**修改收藏排序逻辑**：排序在 `GET /api/favorites` 中由数据库 ORDER BY 完成，修改 `favorites.service.ts` 中的查询条件即可。

**调试外部 API**：数据源请求逻辑集中在 `KlineService`（新浪/Yahoo K线）和 `StocksService`（东方财富行情），在这两个 service 内打日志即可，无需改动 controller。

**调试监控轮询**：轮询日志通过 NestJS `Logger(MonitorService.name)` 输出，搜索 `[轮询]` 前缀。手动触发一次轮询：`curl -X GET http://localhost:3000/api/monitor/rules` 验证规则是否正确，重启服务后首次开盘轮询自动开始。

**配置邮件通知**：复制 `backend/.env.example` 为 `backend/.env`，填入 163 邮箱账号和 SMTP 授权码。邮件日志搜索 `[邮件]` 前缀；未配置时后端启动日志会打印 `EMAIL_USER 或 EMAIL_PASS 未配置，邮件通知已禁用`。

**切换数据库**：在 `backend/.env` 中同时填写 `MYSQL_HOST` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` 三项即启用 MySQL；任一项缺失则自动使用本地 SQLite（`./stock-assistant.db`），无需改代码。

**调试基金数据**：基金净值从东方财富 `https://api.fund.eastmoney.com/f10/lsjz` 拉取，实时估值从 `https://fundgz.1234567.com.cn/js/{code}.js` 拉取；逻辑在 `backend/src/fund/fund.service.ts`。基金详情页路由为 `/fund/:code`，直接在浏览器地址栏访问即可。

---

## 文档同步规范

**代码与规范文档必须保持一致。** 有两类情况必须在同一次任务中同步修改对应文档，不能只改代码：

1. **纠错**：发现规范文档（`PRD.md` / `TECH_DESIGN.md` / `AGENTS.md`）中的定义有误、不完整或需要调整
2. **增量**：新增了文档尚未覆盖的功能细节（新接口、新字段、新枚举值、新设计约定等）

适用场景举例：
- 发现东方财富 API 的实际返回字段与 `TECH_DESIGN.md` 中的 response 结构不符 → 修正 `TECH_DESIGN.md`
- K 线数据格式与文档定义有出入 → 更新 `TECH_DESIGN.md` 中的接口设计
- 实现中发现某个字段名、枚举值与文档不一致 → 以代码为准，回写文档
- 新增了 API 接口或响应字段 → 在 `AGENTS.md` 接口一览 / `TECH_DESIGN.md` 中同步添加对应条目
- 新增了 K 线周期枚举值 → 更新 `AGENTS.md` 中 `period` 枚举列表
- 新增了缓存策略或 TTL 规则 → 更新 `AGENTS.md` 缓存层描述
- 新增了 `AGENTS.md` 未覆盖的常见任务类型 → 在「常见任务指引」中补充入口

操作要求：
1. 完成代码改动后，检查此次改动是否与三份规范文档中的任何描述产生了出入，**以及是否新增了文档尚未覆盖的功能细节**
2. 有出入或有新增细节则立即修改对应文档，与代码保持一致
3. 不允许以「后续再同步文档」为由跳过这一步

---

## 测试规范

- 后端 Service 层的业务逻辑（如 MACD 计算、K 线数据映射）需有对应单元测试
- 每次改动 Service 后，运行 `cd backend && pnpm test` 确保无回归
- 不要求 Controller、前端组件、前端 API 层写测试
- 前端纯工具函数（`utils/`）和含复杂逻辑的 store action 需有对应单元测试
- 外部 API（东方财富）调用须在测试中 mock，不发真实请求

---

## 代码规范

### 配置文件位置
- `.prettierrc` — 根目录，前后端共用
- `frontend/.eslintrc.cjs` — 前端专用（React + TypeScript 规则）
- `backend/.eslintrc.js` — 后端专用（NestJS + TypeScript 规则，由 NestJS CLI 自动生成）

### 操作要求
- 完成任何代码改动后，在对应目录运行 `pnpm lint`，确保无报错再收工
- 不要手动调整格式（缩进、引号、分号等），交给 Prettier 统一处理

---

## 注意事项

- 数据库文件（SQLite 模式）在 `backend/stock-assistant.db`，不提交到 git；MySQL 模式下无本地文件
- 配置 `MYSQL_HOST` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` 三个环境变量时连接 MySQL；任一缺失则自动使用本地 SQLite
- 东方财富 API 无需鉴权，但请求频率过高可能被限流，注意控制并发
- 前端 `/api` 路径由 Vite 代理转发，生产部署需另行配置 Nginx 反向代理
- K 线图组件是全局复用组件，修改时注意不要破坏其通用性
