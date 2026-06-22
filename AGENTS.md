# AGENTS.md — 股票助手

AI 编码代理的协作指南，帮助快速理解本项目并高效完成任务。

---

## 项目概述

个人股票助手，支持 A股 + 港股的收藏管理与 K 线行情查看。

- **前端**：React 19 + Vite + TypeScript + Ant Design + Lightweight Charts (TradingView) + Zustand
- **后端**：NestJS + TypeORM + MySQL（可选，未配置时回退 SQLite）
- **数据源**：东方财富（搜索 + 行情 + 基金）；K线用腾讯财经（A股/ETF 全周期 + 港股日/周线，日/周线**前复权**）+ Yahoo Finance（港股分时/分钟线）

---

## 目录结构

```
stock-assistant/
├── .husky/                # Git 钩子配置目录
├── frontend/src/
│   ├── components/
│   │   ├── Sidebar/             # 左侧面板（顶端 Select 切换股票/基金模式）
│   │   ├── KLineChart/          # K线图公共组件（封装 Lightweight Charts）
│   │   ├── NavChart/            # 基金净值折线图组件（封装 Lightweight Charts）
│   │   ├── HoldingKlinePopup/   # hover 弹出近期日 K 线图（持仓/列表页复用）
│   │   ├── StockSearch/         # 股票搜索组件
│   │   ├── FundSearch/          # 基金搜索组件
│   │   ├── MonitorCenter/       # 左下角消息通知中心弹窗
│   │   └── StockMonitorButton/  # 个股监控规则按钮（嵌入详情页标题栏）
│   ├── pages/
│   │   ├── Home/           # 首页（暂空）
│   │   ├── StockDetail/    # 股票详情页
│   │   ├── FundDetail/     # 基金详情页（路由 /fund/:code）
│   │   ├── StrategyBacktest/     # 策略回测页（路由 /strategy-backtest/:code）
│   │   └── StockListImport/      # 股票列表页（路由 /stock-list-import，导入文件查看，数据不入库）
│   ├── store/
│   │   └── favoritesStore.ts  # Zustand 全局状态
│   ├── api/
│   │   └── stock.ts           # 所有后端 API 请求封装
│   └── types/                 # TypeScript 类型定义
├── backend/src/
│   ├── stocks/                # 股票搜索 + 基本信息接口
│   ├── kline/                 # K线数据接口（统一封装多市场数据源，含指标计算）
│   ├── fund/                  # 基金净值接口（东方财富 lsjz + 实时估值）
│   ├── favorites/             # 收藏夹 CRUD + SQLite 实体
│   ├── monitor/               # 监控规则 + 触发消息 + SSE 推送 + 邮件通知
│   ├── strategy/              # 策略回测（strategies/ 下为可扩展策略实现）
│   ├── cache.ts               # MemCache + 交易时段感知 TTL
│   ├── app.module.ts
│   └── main.ts
├── package.json           # 根目录工作区配置及依赖
├── pnpm-workspace.yaml    # pnpm 工作区定义
└── pnpm-lock.yaml         # 全局依赖锁定文件
```

---

## 启动开发环境

```bash
# 1. 在项目根目录下执行一键安装（自动关联并安装前端、后端及 Husky 依赖）
pnpm install

# 2. 启动后端开发服务（端口 3000）
cd backend
pnpm start:dev

# 3. 启动前端开发服务（端口 5173，/api 代理到 3000）
cd frontend
pnpm dev
```

---

## API 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/favorites?watchListId=` | 获取指定列表的收藏（`watchListId` 必需，pinned desc, sort_order asc） |
| POST | `/api/favorites` | 添加收藏（body `{ code, market, name, watchListId }`，`watchListId` 必需；market 与列表板块不匹配时返回 400） |
| DELETE | `/api/favorites/:id` | 删除收藏 |
| PATCH | `/api/favorites/:id` | 更新排序 / 置顶状态 |
| GET | `/api/watchlists?boardType=stock\|fund` | 获取该板块的标的列表（`isDefault` 列表「收藏夹」排最前，其余按创建时间升序） |
| POST | `/api/watchlists` | 新建自定义标的列表，body `{ name, boardType }` |
| DELETE | `/api/watchlists/:id` | 删除标的列表（默认列表「收藏夹」不可删，返回 400；级联删除列表内的收藏） |
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
| GET | `/api/fund/:code/holdings` | 获取基金最近两期前10大持仓股（季报） |
| GET | `/api/strategy/list` | 策略清单（返回 `{ id, name }[]`，`id` 为稳定标识、`name` 为可变展示名） |
| GET | `/api/strategy/backtest?market=&code=&startDate=&endDate=&period=&strategy=` | 策略回测（返回回测结果、K线数据、交易信号） |

`market` 取值：`A`（A股 + 场内ETF）/ `HK`（港股）

`period` 枚举：`timeshare` `1min` `5min` `15min` `30min` `60min` `daily` `weekly`

`strategy` 取**策略 id**（稳定标识，非展示名；展示名可改而 id 不变）：`trend2`（日线趋势策略2，自适应双模式：趋势骑乘 + 反弹，注意有过拟合）、`trend5`（经典框架-趋势跟随+分层止损+趋势确认，经典趋势跟随入场框架 + 棘轮三段止损 + MA60 斜率确认 + 个股/ETF 双参数集，多区间样本调优的稳健版）、`trend8`（全新独立框架：趋势骑乘式入场 + 自适应 Parabolic SAR 离场 + 高潮反转日离场，针对「沿趋势骨上行→加速大涨→冲高快速回落」类标的，目标吃满主升浪并贴顶离场）。可用策略及展示名以 `GET /api/strategy/list` 为准

---

## 关键设计约定

### K线图（`KLineChart` 组件）
- 分时图渲染折线图，其他周期渲染蜡烛线
- 蜡烛线模式下主图右上角有「均线/BOLL」切换按钮，切换主图叠加内容：均线（MA5/10/20/60）或 BOLL(20,2) 布林带（上轨 UP / 中轨 MB / 下轨 DN）；选择状态以全局单值缓存于 localStorage（key `kline:overlay`，取值 `ma`/`boll`），刷新后保持；切换时用当前数据就地重绘（保持视口），不重新拉取；分时模式不显示该按钮。BOLL 三轨数据由后端随 K 线返回（见下文指标计算），前端只渲染
- 副图包含成交量（柱状图，涨红跌绿）和 MACD(12,26,9)
- MACD 由**后端计算**后随 K 线数据一并返回，前端不做指标计算
- 每根 K 线附带 `changePercent` 字段（当日涨跌幅 %，相对前一根 K 线收盘价，保留两位小数；首根无前收为 null），在 `KlineService.calcMACD` 中统一计算，回测接口的 K 线数据同样携带；主图 legend hover 时优先用该字段展示涨跌幅
- 三个图（主图、量图、MACD 图）各有 legend，鼠标在任意图区移动时三者同步更新；`applyData` 将 bars 存入 `barsRef`，`updateAllLegends(time)` 按时间查表统一刷新
- 蜡烛线模式下，主图 legend 在「开/高/低/收」之后展示「当日涨跌幅」（相对前一根 K 线收盘价计算，红涨绿跌；首根 K 线无前收时不展示）
- 30 秒轮询刷新，仅在对应市场交易时段内启用

### 后端 `KlineService`
- **数据源选型**：东方财富 push2his 按 IP 强限流（几次请求即拒连），新浪 getKLineData 不支持复权——二者均不适合做 K线主源；改用**腾讯财经 ifzq**（原生支持前复权、抓取宽松、国内直连）。`fetchBars` 按周期/市场路由：
  - **日/周线**（需前复权）：A股/ETF 与港股均走腾讯 `web.ifzq.gtimg.cn/appstock/app/fqkline/get`（`param=symbol,day|week,,,500,qfq`）。返回中 A股/ETF 取 `qfqday`/`qfqweek` 键，港股取 `day`/`week` 键（港股日线行尾附带分红对象，解析时忽略）
  - **分时/分钟线**（不复权，与原行为一致）：A股/ETF 走腾讯 `ifzq.gtimg.cn/appstock/app/kline/mkline`（周期码 `m1/m5/m15/m30/m60`，分时用 `m1`）；港股腾讯不提供分钟线，仍走 **Yahoo Finance** `query1.finance.yahoo.com/v8/finance/chart`
  - **拉取根数**：日/周线 fqkline 取 500 根；分钟线 mkline 取 **800 根**（该接口有 800 根硬上限，请求 >800 会静默回退到默认 320 根，故取满 800 以最大化日内历史）。注意分钟线历史上限受此 800 根所限：15min≈最近 50 个交易日、30min≈近半年、60min≈近 1 年、5min≈近 16 个交易日——回测/查看的可用起点不会早于该窗口，与所选时间区间无关（mkline 不支持按起始日期回溯更早数据）
- 腾讯 symbol 规则：港股 `hk` + 5 位代码（如 `hk00700`）；A股/ETF `6` 或 `5` 开头用 `sh`（沪市，含 51xxxx ETF），其余用 `sz`（深市，含 15xxxx ETF）
- 腾讯每行均为数组 `[时间, 开, 收, 高, 低, 量, ...]`（注意是开-**收**-高-低顺序），由 `parseTencentRows` 统一解析；时间 `YYYY-MM-DD`（日/周）或 `YYYYMMDDHHMM`（分钟，转为 `YYYY-MM-DD HH:MM`）
- 新增市场/周期在 `fetchBars` 路由与对应 `fetch*` 方法内扩展，上层接口不变

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
- MA 均线穿越规则支持日线（`klinePeriod=null`）、15min（`klinePeriod='15min'`）、5min（`klinePeriod='5min'`）、30min（`klinePeriod='30min'`）和 60min（`klinePeriod='60min'`）等 K 线周期；`maPeriod` 支持 `ma5 | ma10 | ma20 | ma60`；轮询时按 `klinePeriod` 分组拉取 K 线，同一股票的不同周期规则各自复用对应缓存
- 每条规则每 30 分钟最多触发一次（`lastTriggeredAt` + `COOLDOWN_MS = 30 * 60_000`）
- 触发后写入 `monitor_messages` 表，并通过 RxJS `Subject` 推送 SSE 事件至前端
- MA 均线穿越规则重新激活时，`prevAboveMA` 重置为 null，下次轮询重新初始化方向
- 轮询日志格式：`[轮询] 开始检查，共 N 条活跃规则` / `[轮询] 规则 #id 触发 ...` / `[轮询] 完成，触发 N 条规则`
- 前端 `useMonitorSSE` hook 通过 `EventSource(/api/monitor/events)` 接收推送，写入 `monitorStore`
- `MonitorCenter` 组件固定在页面左下角（sidebar 宽度范围内居中），弹窗仅展示「消息通知」列表，不再包含监控规则管理；消息分页加载（每页 20 条，已读/未读均可翻页），`getMessages` 不标记已读；每次加载完一页后，store 内自动提取本页未读 ID 调用 `PATCH /api/monitor/messages` 批量标记已读并刷新未读角标；未读角标通过独立接口 `getUnreadCount` 维护，SSE 推送到达时立即 +1
- `StockMonitorButton` 组件嵌入各股票详情页标题栏右侧，Badge 显示该股票活跃规则数；弹窗展示并管理该股票的监控规则（增删、激活/暂停），添加规则无需选择股票（已由页面上下文确定）

### 股票列表页（`StockListImport` 页面）
- 路由：`/stock-list-import`，Sidebar Section Select 新增「列表」选项切换进入；进入后搜索框与收藏列表隐藏
- 支持导入 Excel（.xlsx/.xls）和 CSV 文件，使用 `xlsx` npm 包解析
- 解析规则：第一行非纯数字（非 4–6 位数字）时识别为表头行；第一列为股票代码，第二列为名称，其余列原样保留；解析使用 `raw: false` 以保留前导零（如 `000858`、`00700`）
- 市场推断：6 位纯数字代码 → A 市场；其余 → HK 市场；用于传给 `HoldingKlinePopup`
- 数据仅展示，不写入数据库
- 名称列 hover 时弹出近 6 个月日 K 线图，复用 `HoldingKlinePopup` 组件（已扩展可选 `market` 参数，默认 `'A'`）
- 表格分页展示（默认每页 50 条），支持切换分页大小

### 基金模块（`FundModule`）
- 路由：`/fund/:code`，`code` 为基金代码（如 `000001`），无 market 参数
- 搜索数据源：东方财富 `fund.eastmoney.com/js/fundcode_search.js` 全量基金列表（约 2 万条），首次加载后进程内缓存 24h，`searchFunds` 在内存中过滤返回前 10 条，单次搜索结果仍缓存 5min
- 净值数据源：东方财富 `lsjz` API（历史净值）+ `fundgz.1234567.com.cn` JSONP API（实时估值）；lsjz 单页实际上限为 20 条，`getFundNav` 按 `limit` 自动分页并发拉取
- 三个接口并发请求，任一失败均降级处理（估值不可用时不展示估值字段；规模/成立日期不可用时不展示对应字段）
- 规模、成立日期通过抓取 `fundf10.eastmoney.com/jbgk_${code}.html` 并正则提取，失败时降级为 null
- 历史净值接口返回最新在前，`FundService` 反转为时间正序供图表使用
- Sidebar 顶端 Select 切换股票/基金模式，模式由当前 URL 路径决定（`/fund/*` → 基金模式，其余 → 股票模式）；切换时分别导航到 `/stock` 或 `/fund`；`/` 重定向到 `/stock`
- `NavChart` 组件：Lightweight Charts 折线图，仅展示单位净值（蓝色）一条线；时间区间通过 `limit` 参数控制（1M=25/3M=70/6M=135/1Y=255/3Y=760/ALL=1000）
- 缓存 TTL：`getFundInfo` 盘中 30s，盘外 10min；`getFundNav` 盘中 1min，盘外 1h；`getFundHoldings` 固定 1h（季报数据变化频率低）
- 持仓数据源：`fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc`，返回 JS 变量，解析其中 content HTML；先取当年，不足三期则补拉上一年；最多返回最近三期
- 持仓表格列结构因季报新旧而不同，同一基金不同期的列数和列顺序均可能不同；`detectRatioIdx` 方法扫描每个 block 的表头行，定位含"净值"文本的列索引，从而精准读取占净值比例，不依赖固定列号
- `FundHolding` 字段：`rank`、`code`、`name`、`latestPrice`（最新价，number|null）、`marketValue`（占净值比例 %，number|null）

### 策略回测模块（`StrategyModule`）

**路由与接口**
- 前端路由：`/strategy-backtest/:code`，`code` 为股票代码（如 `600000` 或 `00700`），market 由代码推断
- 后端 `StrategyService` 提供回测接口，支持指定时间区间、K 线周期、回测策略
- 回测结果包含：区间涨跌、回测收益、最大回撤、夏普比率、交易次数、交易详情、带交易信号的 K 线数据
- 交易次数按买卖动作计数（买入一次、卖出一次，即完整交易笔数 × 2，含末根强制平仓的买卖各一次）

**分层架构（指标 vs 策略）**
- 「股票指标」（MACD/MA/RSI/`attrs`）由**接口层 `KlineService.calcMACD`** 统一计算并随每根 K 线返回，策略层只读消费、不重算
- 「策略信息」（`shouldHold`/`cumulHold`/买卖信号/交易）由各策略自行计算
- `StrategyService.backtest` 是通用 runner：拉取 K 线 → 按区间截取并预热 → 调用策略 → 计算通用回测指标（收益/最大回撤/夏普）。夏普为**净值逐周期收益率的年化夏普**（持仓期按收盘 mark-to-market、空仓期记 0，样本标准差 × 年化因子），非「每笔交易收益率」口径，避免少量交易塌缩分母产出伪值；年化因子按 K 线周期自适应：daily=√252、weekly=√52、日内 Nmin=√(252×每日根数)（A 股 240 分钟/日，如 5min=√(252×48)）

**策略抽象与扩展**
- `backend/src/strategy/strategies/` 下：`strategy.interface.ts` 定义 `Strategy` 接口（`readonly id`（稳定标识，注册表键与接口 `strategy` 参数取值，一经确定不可改）、`readonly name`（展示名，可随时改）、`run({ bars, testStartIndex, isEtf })` → `{ trades, signals }`，纯函数）；`StrategyContext.isEtf` 由 `backtest()` 按市场/代码推断（A 市场且代码 1/5 开头视为场内 ETF），供策略切换参数集（如 trend5 的 ETF 专用突破回看），普通策略可忽略该字段；`trend2.strategy.ts`（id `trend2`）、`trend5.strategy.ts`（id `trend5`）、`trend8.strategy.ts`（id `trend8`）为各策略实现；`index.ts` 维护「id→策略实例」注册表，并导出 `listStrategies()`（`{ id, name }[]`）供接口层
- **新增策略**：实现 `Strategy` 接口（含唯一 `id` 与 `name`）并在 `index.ts` 的 `STRATEGIES` 数组注册即可，`backtest()`、controller 与前端均无需改动——前端策略下拉通过 `GET /api/strategy/list` 动态获取
- **改策略名**：只改对应策略实现的 `name` 字段；`id` 不变，已存的回测配置与缓存不受影响（用 id 识别，不会因改名失效）

> **末根强制平仓（`forcedClose`）通用约定**：回测结束仍持仓时以最后一根收盘价平仓，盈亏照常计入收益/回撤/夏普/交易次数，但**不在图上标卖出信号、不生成卖出交易记录**（交易记录该笔只保留买入行）。各趋势策略均遵循此约定。
>
> **`cumulHold` 通用口径**：当前 K 线之前连续 `shouldHold` 为 true 的根数，不含自身、遇 false 归零（`cumulHold[i] = shouldHold[i-1] ? cumulHold[i-1] + 1 : 0`，首根为 0，目前仅返回、前端暂不绘图）。

**日线趋势策略2（id `trend2`）—— 自适应双模式（趋势骑乘 + 反弹）**
- 设计定位：单一固定策略无法同时应对「强趋势单边上涨」与「震荡/阴跌」，故 v2 内置行情识别，按当前 K 线自动切换两种模式（两模式以 MACD 零轴方向天然互斥，同一根优先判定趋势模式）；由 `trend2.strategy.ts` 实现
- 趋势成熟度指标 `TAR = MA20/MA60`（中期均线相对长期均线的位置），用于评估趋势/下跌的严重程度，给两种模式各加一道「极端行情」门槛（仅在 MA60 可用时生效）
- **趋势骑乘模式**（强趋势，吃主升浪）：入场需 `MA5 > MA10 > MA20`（多头排列）且 `close > MA10` 且 `MA10` 拐头向上且当日上涨且 `dif > dea` 且 `dif > 前一日 dif` 且 `dif > 0`（零轴上方走强），并通过**强趋势闸门**——价格乖离 `close/MA20 ≥ EXT_GATE`（默认 1.06）且 MA20 日斜率 `(MA20/前一日MA20 - 1)×100 ≥ SLOPE_GATE_PCT`（默认 0.6）、且 `TAR ≤ TAR_OVERHEAT_MAX`（默认 1.10，趋势未过热）；出场 `close < MA10`
- **反弹模式**（震荡/阴跌后的底部反转，快进快出）：入场需 `close > MA10` 且 `close > MA20` 且 `MA5 > MA10` 且 `MA10` 拐头向上且当日上涨且 `dif > dea` 且 `dif > 前一日 dif` 且 `dif < 0`（零轴下方金叉）且 `RSI6 ∈ [REBOUND_RSI_MIN, REBOUND_RSI_MAX)`（默认 [55, 70)，反弹需有真实力度——既不接弱势死猫跳、也不追超买）、且 `TAR ≥ TAR_SEVERE_MIN`（默认 0.90，下跌不至过于严重，避免接飞刀）；出场 `close < MA5`
- 开仓时记录模式，平仓按对应模式的出场条件（趋势→跌破 MA10、反弹→跌破 MA5）；买卖互斥，不在同根触发
- 随 K 线返回的策略字段：`shouldHold` 在 v2 定义为「趋势向上的可持仓状态」（`close > MA10 && MA5 > MA10`）；末根强制平仓与 `cumulHold` 口径见上文通用约定
- 可调参数 `EXT_GATE`/`SLOPE_GATE_PCT`/`REBOUND_RSI_MIN`/`REBOUND_RSI_MAX`/`TAR_OVERHEAT_MAX`/`TAR_SEVERE_MIN` 为 `trend2.strategy.ts` 顶部常量；所有入场条件均为**与价格刻度无关**的相对量（均线大小关系、零轴方向、价格对 MA20 的乖离比率、MA20 百分比斜率、RSI、MA20/MA60 比率），不含随股价高低失真的绝对阈值
- ⚠️ **过拟合提示**：v2 的多个参数是在少量标的、单一区间上调出来的，27 只标的 × 多区间的样本外验证显示其聚合表现一般（训练窗中位数为负、牛市大幅跑输买入持有）。追求样本外稳健请优先用 `经典框架-趋势跟随+分层止损+趋势确认`（id `trend5`）

**经典框架-趋势跟随+分层止损+趋势确认（id `trend5`）—— Donchian 突破入场 + 棘轮三段止损 + MA60 斜率确认（多区间样本调优的稳健版）**
- 设计定位：以业界经典趋势跟随框架（regime 过滤 + Donchian 突破 + 阳线入场）为底，把出场换成棘轮三段止损、入场加趋势确认，并区分个股/ETF 两套参数；由 `trend5.strategy.ts` 实现，经 `scripts/batch-backtest.mjs`（64 标的 × 4 区间）多 regime 样本调优。已用 27 只标的 × 多区间样本外验证
- **棘轮式三段止损**（止损位只升不降）：① 初始止损 `买价 − initMult×ATR(入场日)`；② 保本止损——浮盈达 `breakevenMult×ATR(入场日)` 后止损上移到买入价；③ ATR 跟踪止损（chandelier）`峰值收盘 − trailMult×ATR(当日)`；三者取最高，收盘跌破即离场
- **入场加趋势确认（核心）**：样本暴露最大失血点在**下跌市 whipsaw**（regime `close>MA60 && MA20>MA60` 在下跌初期/中继反弹仍成立，反复买突破被切），故额外要求 **MA60 自身上行**（`ma60[i] > ma60[i − ma60SlopeLookback]`，默认 10 日）；下跌市 MA60 走平/向下时整段空仓。抗过拟合（相对量、无绝对阈值），代价是上涨初期入场略滞后
- **双参数集**：参数以 `STOCK_PARAMS` / `ETF_PARAMS` 两套常量组织在 `trend5.strategy.ts` 顶部（字段 `breakoutLookback`/`atrPeriod`/`initMult`/`breakevenMult`/`trailMult`/`ma60SlopeLookback`），`run()` 按 `ctx.isEtf` 选用。个股：突破 20、初始 2×、保本 1×、跟踪 **3.5**×ATR、斜率 10；ETF：**仅把突破回看 20→40**（低波动篮子假信号多，要求更强趋势确认），其余与个股一致——经 ETF 子样本验证优于更长(50+)/更短(30)或额外放宽止损
- **趋势过滤与突破入场**：仅在 `close > MA60` 且 `MA20 > MA60`（中期趋势向上）的 regime 下做多，且收盘创近 `breakoutLookback` 日新高（Donchian 突破）并当日上涨才入场；ATR(14, Wilder 平滑)、近 N 日最高收盘由策略在 bars 序列上自算（依赖回测预热区间），MA/changePercent 取自接口层
- `shouldHold`（=中期上升趋势状态 `close > MA60 && MA20 > MA60`）/`cumulHold`、末根强制平仓见上文通用约定
- **行为特征（样本聚合，64×4 区间）**：收益中位 −0.31%、收益均值 0.81%、回撤中位 3.55%、夏普中位 0.00，**现有策略中各项聚合指标最优**；价值在下跌/震荡市的回撤保护，单边上涨市参与但滞后买入持有（只做多趋势跟随的固有特征）

**抛物线趋势骑乘（id `trend8`）—— 趋势骑乘入场 + 自适应 Parabolic SAR 离场 + 高潮反转日离场（独立框架，非 trend5 迭代）**
- 设计定位：针对「先沿趋势骨缓慢上行 → 走着走着加速大涨（抛物线/主升浪）→ 冲到高点后快速回落」的题材/趋势股，目标是吃满整段趋势（含末端垂直拉升）同时在顶部尽早离场、少回吐（利益最大化）；由 `trend8.strategy.ts` 实现，与 trend5 共用接口层指标但**框架完全独立**（不用 Donchian 突破 / ATR 棘轮）
- 设计取材：业界对「blow-off top」的公认离场工具是 **Welles Wilder 的 Parabolic SAR**——加速因子（AF）随价格每创新高递增，趋势越陡止损位收得越快，相当于「随趋势成熟自动加速上移的动态地板」，能在抛物线顶部附近贴住价格、先于滞后的均线/ATR 离场
- **入场（趋势骑乘式，非突破）**：中期趋势骨向上（`close>MA20>MA60` 且 `MA60` 上行，`ma60[i] > ma60[i−ma60SlopeLookback]`）+ 多头排列站上最快均线（`MA5>MA10` 且 `close>MA5`）+ 当日阳线 + MACD 零轴上方多头（`dif>dea` 且 `dif>0`）
- **离场（两道，取先触发）**：① **自适应 Parabolic SAR**：入场时 SAR 初始化为近 `sarInitLookback` 根最低价，EP=入场日最高价，AF 从 `afStart` 起每创新高 +`afStep`；钳制 `SAR ≤ min(前两根最低价)`（Wilder 规则）；当**抛物线过热**（自入场以来峰值相对 MA20 乖离 ≥ `extGatePct`）时把 AF 上限由 `afMaxBase` 抬到 `afMaxHot`，使主升浪末端止损收得更紧；收盘跌破当日 SAR 即离场。② **高潮反转日**（同日落袋，抢在 SAR 之前）：过热状态下当日跌幅 ≥ `climaxDropPct` 且阴线，即当日收盘离场（SAR 以「收盘<当日 SAR」判定，对「创新高后当日暴力反转」天然滞后一根，故单设此即时离场）
- 所有判定均为相对量（均线大小关系/斜率、价格对 MA20 乖离比率、单日涨跌幅、SAR 与收盘相对位置），无随股价高低失真的绝对阈值
- 参数集见 `trend8.strategy.ts` 顶部 `STOCK_PARAMS`/`ETF_PARAMS`（字段 `ma60SlopeLookback`/`afStart`/`afStep`/`afMaxBase`/`afMaxHot`/`sarInitLookback`/`extGatePct`/`climaxDropPct`；ETF 集过热/高潮阈值相应放低，仅用于泛化）；`shouldHold`（中期上升趋势状态）/`cumulHold`/末根强制平仓口径与其他趋势策略一致
- **行为特征（「高点处理」38 标的 × 2026 区间实测）**：收益中位优于 trend5（如 2026-01-13~06-18 区间收益中位 25.87 vs trend5 13.88；2026-04-01~06-18 区间 26.54 vs 17.77），夏普中位亦最高；对「暴力 blow-off」标的提升显著（贴顶离场），代价是对「长多浪」标的会更早离场、回撤中位偏高（属「锁定主升浪、少回吐」定位的固有取舍）

**指标计算（接口层统一口径）**
- MACD(12,26,9)（标准参数，全项目统一）、MA5/10/20/60、BOLL(20,2)、RSI 均在 `KlineService.calcMACD` 计算后随每条 K 线返回，回测层直接消费、不重算，故回测信号与 K 线图指标完全一致
- BOLL(20,2) 以 `boll` 对象返回（`upper`/`mid`/`lower`，均 `number | null`）：中轨 = 20 周期 SMA（即 MA20），上/下轨 = 中轨 ± 2×总体标准差（除数为 N，通达信/同花顺口径），窗口不足 20 根时三轨为 null；目前仅 K 线图主图「BOLL」叠加使用
- RSI 以 `rsi` 对象返回，目前仅含 `rsi6`（6 周期，通达信口径 Wilder 平滑 `RSI = avgGain/(avgGain+avgLoss)*100`，首根 K 线无前收返回 null），其他周期需要时再扩展

**前端页面**
- 标题栏右侧提供收藏（星标）按钮，复用 `favoritesStore`（`addStock`/`removeStock`）；标题展示股票名称（`stocksApi.getInfo` 获取，缺失时回退为代码）
- localStorage 缓存：回测配置以**全局单条「最近一次回测配置」**存储（key `backtest:params`，不按股票分组），刷新或切换股票时自动套用（market 不入缓存，由代码推断）；回测结果以 `backtest:result` 缓存（key 含 `code|market|period|strategy|startDate|endDate`），仅当当前股票 + 配置与缓存完全一致时回填并显示「已缓存」标签
- K 线图复用 `KLineChart` 组件：**回测前即展示**——未回测时以拉取模式按所选周期渲染 K 线（含均线/BOLL/MACD/RSI/ljj 副图），仅不渲染买卖点（普通 K 线无 `signal` 字段），周期通过受控 `period` prop 由页面下拉驱动、随交易时段自动轮询；回测后改用 `initialData` 传入回测返回的 K 线数据（叠加买卖信号与回测起始标记）并禁用自动轮询。`KLineChart` 的 `period` prop 为拉取模式下的外部受控周期（配合 `showPeriodTabs=false`），有 `initialData` 时以其 `period` 为准
- **回测前预览视口对齐回测区间**：回测页通过 `viewStartDate`/`viewEndDate`（YYYY-MM-DD）prop 把当前表单的开始/结束时间传给拉取模式的预览图，预览默认视口取 `[viewStartDate−5根, viewEndDate]`（与回测结果视图同样前留 5 根历史上下文），**优先于持久化 zoom**；表单时间区间变化时就地重新取景（不重新拉取），从而点击「开始回测」后视口不跳到别的时间。该 prop 仅在无 `initialData` 的拉取模式下生效

**K 线图副图（仅回测页启用）**
- `showRsi`：常规 RSI 副图，只画 RSI6（6 个交易日）曲线，数据取 K 线的 `rsi.rsi6`
- `showLjj`：「ljj」自定义副图，用堆叠柱状图展示每根 K 线满足的综合属性数（每满足一个属性柱高 +1，不同属性不同色）
  - 属性在后端计算，随每根 K 线以 `attrs` 对象返回（布尔字段 `kmacd`/`krsi`/`kma`），由 `KlineService` 导出的纯函数 `computeKlineAttrs(bar, prevDif)` 在 `calcMACD` 中统一计算（回测层直接复用）
  - 属性定义（按堆叠优先级自底向上）：
    - **KMACD**（橙色，柱底）：`dif > 0` 且 `macd.dif - macd.dea > -0.1`（DIF 接近或高于 DEA）且 DIF 上升（`dif[i] - dif[i-1] > -0.06`，允许 0.06 以内微跌）
    - **KRSI**（蓝色，中部）：`rsi.rsi6 >= 50`
    - **KMA**（绿色，顶部）：`close > ma10` 且 `ma5 / ma10 > 0.995`
  - 渲染：用 3 个 Histogram series 叠加模拟堆叠（lightweight-charts 无原生堆叠）——先画整柱(顶段色)，再依次覆盖较矮的中段、底段露出各色带；副图 legend 显示 `KMACD/KRSI/KMA` 的 ✓/✗

### 状态管理（Zustand）
- 收藏列表和当前选中股票均通过 `favoritesStore` 管理
- 标的列表（`stockLists`/`fundLists`）及当前选中列表 id（`currentStockListId`/`currentFundListId`）通过 `watchListStore` 管理；当前选中列表 id 按 boardType 分别缓存于 localStorage（key `watchList:current:stock` / `watchList:current:fund`），`fetchLists` 拉取列表后优先沿用已选 id，其次回退到 localStorage 中保存的 id（若仍存在于新列表中），都不满足则回退到 `isDefault` 列表或第一个列表；`setCurrentList`/`createList`/`deleteList` 变更选中列表时同步写入 localStorage，刷新页面后默认展示上次选中的列表
- 监控规则和消息通过 `monitorStore` 管理，规则数据从后端 API 获取（不用 localStorage）
- 组件不直接调用 API，通过 store action 触发请求

---

## 常见任务指引

**新增一个 API 字段**：先改 `backend/src/stocks/stocks.service.ts` 中的数据映射，再更新 `frontend/src/types/` 中对应的 TypeScript 类型。

**新增 K 线周期**：在后端 `KlineService` 的 period 映射中添加枚举值，同时在前端 `KLineChart` 的 TAB 配置中添加对应选项。

**修改收藏排序逻辑**：排序在 `GET /api/favorites` 中由数据库 ORDER BY 完成，修改 `favorites.service.ts` 中的查询条件即可。

**调试外部 API**：数据源请求逻辑集中在 `KlineService`（腾讯前复权 K线/分钟 + Yahoo 港股分钟）和 `StocksService`（东方财富行情），在这两个 service 内打日志即可，无需改动 controller。K线上游失败时控制台打印 `[kline] upstream error ...`。

**调试监控轮询**：轮询日志通过 NestJS `Logger(MonitorService.name)` 输出，搜索 `[轮询]` 前缀。手动触发一次轮询：`curl -X GET http://localhost:3000/api/monitor/rules` 验证规则是否正确，重启服务后首次开盘轮询自动开始。

**配置邮件通知**：复制 `backend/.env.example` 为 `backend/.env`，填入 163 邮箱账号和 SMTP 授权码。邮件日志搜索 `[邮件]` 前缀；未配置时后端启动日志会打印 `EMAIL_USER 或 EMAIL_PASS 未配置，邮件通知已禁用`。

**切换数据库**：在 `backend/.env` 中同时填写 `MYSQL_HOST` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` 三项即启用 MySQL；任一项缺失则自动使用本地 SQLite（`./stock-assistant.db`），无需改代码。

**批量策略回测（多标的×多区间）**：`scripts/batch-backtest.mjs` 对「收藏夹有效标的 + 内置无偏抽样篮子（沪深300/中证500-1000/科创/宽基+行业ETF/港股，共 50 只）」跨 4 个时间区间调用 `/api/strategy/backtest`，汇总成**分布口径**（收益中位数、跑赢买入持有胜率、P25/P75 分位、回撤中位数、夏普中位数、空仓率），输出 `all_strategy_result_broad.md` 与明细 `batch_backtest_raw.csv`。需后端先在 3000 端口运行；标的篮子/区间在脚本顶部常量 `EXTRA`/`WINDOWS` 调整。`scripts/compare-strategies.mjs <id...> [--only=etf|stock]` 是配套的**快速 A/B 迭代工具**（复用同一篮子/区间，打印紧凑的按区间+总体分布对比，`--only=etf` 仅跑场内 ETF 子集），调策略参数时用它快速看多区间效果。

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
- CI 自动测试：已配置 GitHub Actions 单元测试与语法检查工作流，在提交 PR 到 `main` 分支时会自动运行对应的后端测试与前后端语法检查。
- 本地提交检查：配置了 Git pre-commit 钩子（`.git/hooks/pre-commit`），在本地执行 `git commit` 时，若检测到 `frontend` 或 `backend` 目录下有变更，会自动触发对应模块的语法检查。其中，ESLint 检查仅针对本次改动的文件以提高提交效率，而 TypeScript 类型检查仍对整个项目执行以确保类型安全。
- 本地推送检查：配置了 Git pre-push 钩子（`.git/hooks/pre-push`），在本地执行 `git push` 时，若检测到本次推送包含 `backend` 目录下的变更，会自动触发后端单元测试，避免将错误代码推送。


---

## 代码规范

### 配置文件位置
- `.prettierrc` — 根目录，前后端共用
- `frontend/.eslintrc.cjs` — 前端专用（React + TypeScript 规则）
- `backend/.eslintrc.js` — 后端专用（NestJS + TypeScript 规则，由 NestJS CLI 自动生成）

### 操作要求
- 禁止使用superpowers相关skill介入本项目的开发
- 完成任何代码改动后，在对应目录运行 `pnpm lint`，确保无报错再收工
- 不要手动调整格式（缩进、引号、分号等），交给 Prettier 统一处理

---

## 注意事项

- 数据库文件（SQLite 模式）在 `backend/stock-assistant.db`，不提交到 git；MySQL 模式下无本地文件
- 配置 `MYSQL_HOST` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` 三个环境变量时连接 MySQL；任一缺失则自动使用本地 SQLite
- 所有后端 Controller 的路由前缀必须包含 `api/`（如 `@Controller('api/fund')`），不使用 NestJS 全局前缀；新增 Controller 时务必遵循此约定，否则 Vite 代理无法转发
- 东方财富 API 无需鉴权，但请求频率过高可能被限流，注意控制并发
- 前端 `/api` 路径由 Vite 代理转发，生产部署需另行配置 Nginx 反向代理
- K 线图组件是全局复用组件，修改时注意不要破坏其通用性
