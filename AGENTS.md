# AGENTS.md — 股票助手

AI 编码代理的协作指南，帮助快速理解本项目并高效完成任务。

> **本文是导航枢纽**：只承载稳定的项目概览、目录结构、规范与「指向卫星文档的指针」。各模块的深度细节放在 `docs/` 下的卫星文档中——**改某模块就读/改对应卫星文档**，本文件只在新增模块或改变整体架构时才动。详见下方[文档地图](#文档地图)与[文档同步规范](#文档同步规范)。

---

## 项目概述

个人股票助手，支持 A股 + 港股的收藏管理与 K 线行情查看。

- **前端**：React 19 + Vite + TypeScript + Ant Design + Lightweight Charts (TradingView) + Zustand
- **后端**：NestJS + TypeORM + MySQL（可选，未配置时回退 SQLite）
- **数据源**：东方财富（搜索 + 实时行情 + 基金）；K线中分时图 A股 走腾讯、港股走东财（异常时降级 Yahoo），分钟线 A股/ETF 走腾讯、港股走 Yahoo，日/周线前复权均走腾讯

---

## 文档地图

| 文档 | 内容 | 何时读/改 |
|------|------|-----------|
| **AGENTS.md**（本文） | 项目概览、目录结构、启动、规范、任务索引 | 新增模块 / 改整体架构 |
| [docs/api.md](docs/api.md) | 全部 HTTP/SSE 接口一览（按模块分节） | 新增/改接口、字段、枚举 |
| [docs/strategies.md](docs/strategies.md) | 策略回测模块：分层架构、各策略设计、指标计算、回测页与副图、**新增策略模板** | 新增/改策略或回测逻辑 |
| [docs/modules/kline.md](docs/modules/kline.md) | 后端 `KlineService` 数据源选型/路由 + 缓存层 TTL | 改数据源、周期、缓存 |
| [docs/modules/monitor.md](docs/modules/monitor.md) | 监控规则、轮询、SSE、邮件通知 | 改监控/通知 |
| [docs/modules/fund.md](docs/modules/fund.md) | 基金净值/估值/持仓数据源与解析 | 改基金模块 |
| [docs/modules/darktrade.md](docs/modules/darktrade.md) | 暗盘资金抓取、索引、GBK 解码、字段映射 | 改暗盘模块 |
| [docs/modules/frontend.md](docs/modules/frontend.md) | `KLineChart` 约定、列表页、Zustand 状态管理 | 改前端图表/页面/store |
| [PRD.md](PRD.md) / [TECH_DESIGN.md](TECH_DESIGN.md) | 产品需求 / 技术设计 | 见文档同步规范 |

---

## 目录结构

```
stock-assistant/
├── .husky/                # Git 钩子配置目录
├── docs/                  # 卫星文档（见上方文档地图）
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
│   │   ├── Login/          # 登录页（未登录时 App 全屏渲染此页作为入口）
│   │   ├── Home/           # 首页（暂空）
│   │   ├── StockDetail/    # 股票详情页
│   │   ├── FundDetail/     # 基金详情页（路由 /fund/:code）
│   │   ├── StrategyBacktest/     # 策略回测页（路由 /strategy-backtest/:code）
│   │   ├── StockListImport/      # 股票列表页（路由 /stock-list-import，导入文件查看，数据不入库）
│   │   └── StockListKline/       # K线总览页（路由 /stock-list-kline，展示当前标的列表所有股票的 K 线图网格）
│   ├── store/
│   │   ├── authStore.ts       # 登录态（令牌+当前用户），App gate 据此渲染登录页/主界面
│   │   └── favoritesStore.ts  # Zustand 全局状态
│   ├── api/
│   │   ├── token.ts           # 登录令牌的 localStorage 存取 + 401 事件常量
│   │   └── stock.ts           # 所有后端 API 请求封装（axios 拦截器自动带令牌 / 401 退出）
│   └── types/                 # TypeScript 类型定义
├── backend/src/
│   ├── auth/                  # 用户登录：User 实体 + 令牌签发/校验 + 全局 AuthGuard（@Public/@CurrentUser）
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

# 2. 启动后端开发服务（端口 3100）
cd backend
pnpm start:dev

# 3. 启动前端开发服务（端口 5173，/api 代理到 3100）
cd frontend
pnpm dev
```

---

## 模块速览

各模块一句话定位，深度细节点对应卫星文档：

- **用户登录**（[api.md 鉴权](docs/api.md#鉴权auth)）：内置账号密码登录，签发精简版 JWT（HMAC-SHA256，scrypt 存密码）；全局 `AuthGuard` 守卫除登录外的所有 `/api/*`，令牌走 Header 或 query（供 SSE）；标的列表/收藏按用户隔离（`watch_lists.user_id`）。首启种入内置账号 `ljj` 并把历史数据归到其名下
- **K线数据**（[kline.md](docs/modules/kline.md)）：分时图（`timeshare`）A股走腾讯，港股走东财并自动降级 Yahoo；日/周线（前复权）与 A股/ETF 分钟线走腾讯财经，港股分钟线走 Yahoo；`fetchBars` 按周期/市场路由。⚠️ 分钟线上游有 800 根硬上限（15min≈50 交易日且不可回溯），直接约束 15min 回测窗口
- **指标计算**（[strategies.md](docs/strategies.md#指标计算接口层统一口径)）：MACD/MA/BOLL/RSI/`attrs`/`changePercent` 全部由接口层 `KlineService.calcMACD` 统一计算并随每根 K 线返回，前端与回测层只读消费、不重算
- **策略回测**（[strategies.md](docs/strategies.md)）：通用 runner + 可扩展策略注册表；现有策略 `trend2`（日线双模式，有过拟合）/ `trend5`（日线经典趋势跟随，样本外最稳健，默认推荐）/ `trend8`（日线抛物线骑乘，贴顶离场）/ `pullback15`（15min 趋势自适应短波段）。新增策略只需实现接口并在 `index.ts` 注册
- **监控**（[monitor.md](docs/modules/monitor.md)）：30s 轮询，价格/均线穿越规则边沿触发，SSE 推送 + 163 邮件通知
- **基金**（[fund.md](docs/modules/fund.md)）：东方财富 lsjz 历史净值 + 实时估值 + 季报持仓；路由 `/fund/:code`
- **暗盘资金**（[darktrade.md](docs/modules/darktrade.md)）：东方财富数据中心，GBK 解码，K线总览页自动刷新索引
- **前端约定**（[frontend.md](docs/modules/frontend.md)）：`KLineChart` 公共组件、列表/总览页、Zustand store 划分

---

## 常见任务指引

**新增一个 API 字段**：先改 `backend/src/stocks/stocks.service.ts` 中的数据映射，再更新 `frontend/src/types/` 中对应的 TypeScript 类型，并在 [docs/api.md](docs/api.md) 同步。

**新增 K 线周期**：在后端 `KlineService` 的 period 映射中添加枚举值，同时在前端 `KLineChart` 的 TAB 配置中添加对应选项，并更新 [docs/api.md](docs/api.md) 的 `period` 枚举。

**新增一个回测策略**：按 [docs/strategies.md 新增策略模板](docs/strategies.md#新增策略文档模板) 实现接口、在 `index.ts` 注册，并在该文档追加一节。

**修改收藏排序逻辑**：排序在 `GET /api/favorites` 中由数据库 ORDER BY 完成，修改 `favorites.service.ts` 中的查询条件即可。

**用户登录 / 新增账号 / 调整鉴权**：登录逻辑集中在 `backend/src/auth/`（`AuthService` 管哈希/令牌/登录，`AuthGuard` 是全局守卫）。内置账号在 `AuthService.onModuleInit` 种入；令牌密钥用环境变量 `AUTH_SECRET`。某接口要免登录访问时给其加 `@Public()`；取当前用户用 `@CurrentUser()`。前端登录态见 `store/authStore.ts`，未登录由 `App.tsx` 渲染 `pages/Login`。详见 [docs/api.md 鉴权](docs/api.md#鉴权auth)。

**调试外部 API**：数据源请求逻辑集中在 `KlineService`（腾讯前复权 K线/分钟 + Yahoo 港股分钟）和 `StocksService`（东方财富行情），在这两个 service 内打日志即可。K线上游失败时控制台打印 `[kline] upstream error ...`。

**调试监控轮询 / 配置邮件**：见 [docs/modules/monitor.md 调试](docs/modules/monitor.md#调试)。

**切换数据库**：在 `backend/.env` 中同时填写 `MYSQL_HOST` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` 三项即启用 MySQL；任一项缺失则自动使用本地 SQLite（`./stock-assistant.db`），无需改代码。

**批量策略回测（多标的×多区间）**：`scripts/batch-backtest.mjs` 对「收藏夹有效标的 + 内置无偏抽样篮子（沪深300/中证500-1000/科创/宽基+行业ETF/港股，共 50 只）」跨 4 个时间区间调用 `/api/strategy/backtest`，汇总成**分布口径**（收益中位数、跑赢买入持有胜率、P25/P75 分位、回撤中位数、夏普中位数、空仓率），输出 `dist/all_strategy_result_broad.md` 与明细 `dist/batch_backtest_raw.csv`。需后端先在 3100 端口运行；标的篮子/区间在脚本顶部常量 `EXTRA`/`WINDOWS` 调整。`scripts/compare-strategies.mjs <id...> [--only=etf|stock]` 是配套的**快速 A/B 迭代工具**（复用同一篮子/区间，打印紧凑的按区间+总体分布对比，`--only=etf` 仅跑场内 ETF 子集）。

**15min 策略专用测试集**：日线脚本（batch/compare）用日线、覆盖多年多 regime，不适用于 15min（分钟线仅 ~50 交易日且不可回溯）。15min 策略改用 `scripts/backtest15.mjs`——固定一篮子分层 A 股/ETF（`TEST_SET`）× 数据窗口内三区间（`W_full` 全段 / `W_chop` 震荡前半段 / `W_rally` 拉升后半段）。用法 `node scripts/backtest15.mjs pullback15 [trend5...] [--report]`，传 `--report` 写出 `dist/all_strategy_result_15min.md` 与 `dist/batch_backtest_15min_raw.csv`。⚠️ 区间日期随「今天」滑动，隔较久重跑需把脚本顶部 `WINDOWS` 顺移到当前可用窗口内（取不到数据的标的×区间会跳过计入失败、不影响其余统计）。

**使用/调试暗盘资金、基金数据**：分别见 [docs/modules/darktrade.md](docs/modules/darktrade.md)、[docs/modules/fund.md 调试](docs/modules/fund.md#调试)。

---

## 文档同步规范

**代码与规范文档必须保持一致。** 规范文档包括：`PRD.md`、`TECH_DESIGN.md`、`AGENTS.md` 及 `docs/` 下的全部卫星文档。有两类情况必须在同一次任务中同步修改对应文档，不能只改代码：

1. **纠错**：发现规范文档中的定义有误、不完整或需要调整
2. **增量**：新增了文档尚未覆盖的功能细节（新接口、新字段、新枚举值、新设计约定等）

**路由规则（改哪个、动哪份文档）**：

- 改**某个模块的内部细节** → 只动该模块对应的卫星文档（`docs/modules/*.md` 或 `docs/strategies.md`），AGENTS.md 通常不动
- 改/增**接口、字段、枚举** → 动 [docs/api.md](docs/api.md)（必要时连带对应卫星文档）
- **新增整个模块 / 改变整体架构 / 新增常见任务类型** → 才动 AGENTS.md（补「文档地图」「模块速览」「目录结构」「常见任务指引」中的对应条目，并新建卫星文档）
- 涉及产品需求 / 技术设计层面的变化 → 动 `PRD.md` / `TECH_DESIGN.md`

适用场景举例：

- 发现东方财富 API 的实际返回字段与文档不符 → 修正对应卫星文档 / `TECH_DESIGN.md`
- 实现中发现某字段名、枚举值与文档不一致 → 以代码为准，回写文档
- 新增了 API 接口或响应字段 → 在 [docs/api.md](docs/api.md) 同步添加，并更新相关卫星文档
- 新增了 K 线周期枚举值 → 更新 [docs/api.md](docs/api.md) 与前端 TAB
- 新增了缓存策略或 TTL 规则 → 更新 [docs/modules/kline.md](docs/modules/kline.md)
- 新增了 AGENTS.md 未覆盖的常见任务类型 → 在「常见任务指引」中补充入口

操作要求：

1. 完成代码改动后，检查此次改动是否与上述任一文档产生出入，**以及是否新增了文档尚未覆盖的功能细节**
2. 有出入或有新增细节则立即修改对应文档，与代码保持一致；新增模块时同步在「文档地图」登记卫星文档
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
