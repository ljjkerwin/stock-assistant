# AGENTS.md — 股票助手

AI 编码代理的协作指南，帮助快速理解本项目并高效完成任务。

---

## 项目概述

个人股票助手，支持 A股 + 港股的收藏管理与 K 线行情查看。

- **前端**：React 19 + Vite + TypeScript + Ant Design + Lightweight Charts (TradingView) + Zustand
- **后端**：NestJS + TypeORM + SQLite
- **数据源**：东方财富（搜索 + 行情）、新浪财经（A股K线）、Yahoo Finance（港股K线）

---

## 目录结构

```
stock-assistant/
├── frontend/src/
│   ├── components/
│   │   ├── Sidebar/        # 收藏栏（左侧面板）
│   │   ├── KLineChart/     # K线图公共组件（封装 Lightweight Charts）
│   │   └── StockSearch/    # 股票搜索组件
│   ├── pages/
│   │   ├── Home/           # 首页（暂空）
│   │   └── StockDetail/    # 股票详情页
│   ├── store/
│   │   └── favoritesStore.ts  # Zustand 全局状态
│   ├── api/
│   │   └── stock.ts           # 所有后端 API 请求封装
│   └── types/                 # TypeScript 类型定义
└── backend/src/
    ├── stocks/                # 股票搜索 + 基本信息接口
    ├── kline/                 # K线数据接口（统一封装多市场数据源）
    ├── favorites/             # 收藏夹 CRUD + SQLite 实体
    ├── cache.ts               # MemCache + 交易时段感知 TTL
    ├── app.module.ts
    └── main.ts
```

---

## 启动开发环境

```bash
# 后端（端口 3000）
cd backend && npm install && npm run start:dev

# 前端（端口 5173，/api 代理到 3000）
cd frontend && npm install && npm run dev
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

`market` 取值：`A`（A股）/ `HK`（港股）

`period` 枚举：`timeshare` `1min` `5min` `15min` `30min` `60min` `daily` `weekly`

---

## 关键设计约定

### K线图（`KLineChart` 组件）
- 分时图渲染折线图，其他周期渲染蜡烛线
- 副图包含成交量（柱状图，涨红跌绿）和 MACD(4,35,4)
- MACD 由**后端计算**后随 K 线数据一并返回，前端不做指标计算
- 30 秒轮询刷新，仅在对应市场交易时段内启用

### 后端 `KlineService`
- 屏蔽 A股/港股数据源差异：A股 K线用新浪财经 API，港股 K线用 Yahoo Finance API
- 新增市场只需在 `KlineService` 内新增 `fetch*` 方法，上层接口不变

### 缓存层（`cache.ts`）
- `MemCache<T>`：进程内 TTL 缓存，自动过期，无需外部依赖
- `tradingTtl(tradingMs, offHoursMs)`：交易时段（UTC+8 工作日 09:30–12:00、13:00–16:00）返回短 TTL，盘外返回长 TTL
- K线缓存 TTL：分时/1min 盘中 1min，5min–60min 盘中 3min，日线及以上盘中 5min，盘外均延长至 30min–1h
- 行情缓存 TTL：盘中 30s，盘外 10min

### 状态管理（Zustand）
- 收藏列表和当前选中股票均通过 `favoritesStore` 管理
- 组件不直接调用 API，通过 store action 触发请求

---

## 常见任务指引

**新增一个 API 字段**：先改 `backend/src/stocks/stocks.service.ts` 中的数据映射，再更新 `frontend/src/types/` 中对应的 TypeScript 类型。

**新增 K 线周期**：在后端 `KlineService` 的 period 映射中添加枚举值，同时在前端 `KLineChart` 的 TAB 配置中添加对应选项。

**修改收藏排序逻辑**：排序在 `GET /api/favorites` 中由数据库 ORDER BY 完成，修改 `favorites.service.ts` 中的查询条件即可。

**调试外部 API**：数据源请求逻辑集中在 `KlineService`（新浪/Yahoo K线）和 `StocksService`（东方财富行情），在这两个 service 内打日志即可，无需改动 controller。

---

## 文档同步规范

**代码与规范文档必须保持一致。** 如果在编码过程中发现规范文档（`PRD.md` / `TECH_DESIGN.md` / `AGENTS.md`）中的定义有误、不完整或需要调整，必须在同一次任务中同步修改对应文档，不能只改代码。

适用场景举例：
- 发现东方财富 API 的实际返回字段与 `TECH_DESIGN.md` 中的 response 结构不符 → 修正 `TECH_DESIGN.md`
- K 线数据格式与文档定义有出入 → 更新 `TECH_DESIGN.md` 中的接口设计
- 新增了 `AGENTS.md` 未覆盖的常见任务类型 → 在 `AGENTS.md` 的「常见任务指引」中补充
- 实现中发现某个字段名、枚举值与文档不一致 → 以代码为准，回写文档

操作要求：
1. 完成代码改动后，检查此次改动是否与三份规范文档中的任何描述产生了出入
2. 有出入则立即修改对应文档，与代码保持一致
3. 不允许以「后续再同步文档」为由跳过这一步

---

## 测试规范

- 后端 Service 层的业务逻辑（如 MACD 计算、K 线数据映射）需有对应单元测试
- 每次改动 Service 后，运行 `cd backend && npm run test` 确保无回归
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
- 完成任何代码改动后，在对应目录运行 `npm run lint`，确保无报错再收工
- 不要手动调整格式（缩进、引号、分号等），交给 Prettier 统一处理

---

## 注意事项

- SQLite 数据库文件在 `backend/` 目录下，不提交到 git
- 东方财富 API 无需鉴权，但请求频率过高可能被限流，注意控制并发
- 前端 `/api` 路径由 Vite 代理转发，生产部署需另行配置 Nginx 反向代理
- K 线图组件是全局复用组件，修改时注意不要破坏其通用性
