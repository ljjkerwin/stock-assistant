# 股票助手

个人股票助手，支持 A 股 + 港股的收藏管理、K 线行情查看与价格监控报警。

English version: [README.en.md](./README.en.md)

---

## 功能特性

- **收藏栏** — 搜索并收藏 A 股、港股（含场内 ETF），支持拖拽排序与置顶
- **K 线图** — 分时 / 1min / 5min / 15min / 30min / 60min / 日线 / 周线，附成交量副图和 MACD(4,35,4) 副图；盘中 30 秒自动刷新
- **股票详情** — 展示当前价、涨跌幅、成交额、市值、PE 等基本信息
- **监控报警** — 配置价格规则或均线穿越规则，触发时实时推送（SSE）+ 邮件通知；消息中心显示历史触发记录

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · Vite · TypeScript · Ant Design · Lightweight Charts (TradingView) · Zustand |
| 后端 | NestJS · TypeORM · SQLite（默认）· MySQL（可选） |
| 数据源 | 东方财富（搜索 + 实时行情）· 新浪财经（A 股 / ETF K 线）· Yahoo Finance（港股 K 线） |

---

## 目录结构

```
stock-assistant/
├── frontend/src/
│   ├── components/
│   │   ├── Sidebar/              # 收藏栏
│   │   ├── KLineChart/           # K 线图公共组件
│   │   ├── StockSearch/          # 股票搜索
│   │   └── StockMonitorButton/   # 监控规则按钮（嵌入详情页标题栏）
│   ├── pages/
│   │   └── StockDetail/          # 股票详情页
│   ├── store/                    # Zustand 全局状态
│   ├── api/                      # 后端 API 请求封装
│   └── types/                    # TypeScript 类型定义
└── backend/src/
    ├── stocks/                   # 搜索 + 基本信息接口
    ├── kline/                    # K 线数据（多市场统一接口）
    ├── favorites/                # 收藏夹 CRUD
    ├── monitor/                  # 监控规则 + 消息 + SSE 推送
    ├── cache.ts                  # 进程内 TTL 缓存
    └── main.ts
```

---

## 快速开始

### 前置要求

- Node.js ≥ 20
- pnpm ≥ 9

### 开发环境

```bash
# 后端（端口 3100）
cd backend
pnpm install
pnpm start:dev

# 前端（端口 5173，/api 代理到 3100）
cd frontend
pnpm install
pnpm dev
```

---

## 配置

复制环境变量模板并按需填写：

```bash
cp backend/.env.example backend/.env
```

| 变量 | 说明 | 必填 |
|---|---|---|
| `MYSQL_HOST` | MySQL 主机 | 否 |
| `MYSQL_USERNAME` | MySQL 用户名 | 否 |
| `MYSQL_PASSWORD` | MySQL 密码 | 否 |
| `MYSQL_DATABASE` | 数据库名 | 否 |
| `EMAIL_USER` | 163 邮箱账号（发件人） | 否 |
| `EMAIL_PASS` | 163 SMTP 授权码 | 否 |
| `EMAIL_TO` | 收件人邮箱 | 否 |

**数据库**：`MYSQL_HOST` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` 三项同时填写时使用 MySQL，任一缺失则自动回退到本地 SQLite（`./stock-assistant.db`），无需额外配置。

**邮件通知**：填写 `EMAIL_USER` 和 `EMAIL_PASS` 后，监控规则触发时将通过 163 SMTP 发送邮件通知。未配置时自动禁用，不影响其他功能。

---

## 生产部署

### 构建

```bash
cd backend && pnpm build
cd frontend && pnpm build
```

### Nginx 配置

参考 `deploy/nginx.conf`，将前端静态文件目录和后端端口按实际路径调整后配置到 Nginx。SSE 端点 `/api/monitor/events` 需单独配置禁用缓冲（`proxy_buffering off`）。

### 启动后端

```bash
cd backend && node dist/main
```

---

## API 概览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/favorites` | 获取收藏列表 |
| POST | `/api/favorites` | 添加收藏 |
| DELETE | `/api/favorites/:id` | 删除收藏 |
| PATCH | `/api/favorites/:id` | 更新排序 / 置顶状态 |
| GET | `/api/stocks/search?q=` | 搜索股票（A 股 + 港股） |
| GET | `/api/stocks/:market/:code` | 股票基本信息 |
| GET | `/api/kline/:market/:code?period=` | K 线数据 |
| GET | `/api/monitor/rules` | 监控规则列表 |
| POST | `/api/monitor/rules` | 创建监控规则 |
| DELETE | `/api/monitor/rules/:id` | 删除监控规则 |
| PATCH | `/api/monitor/rules/:id` | 切换激活状态 |
| GET | `/api/monitor/messages?page=` | 消息列表（分页） |
| GET | `/api/monitor/messages/unread-count` | 未读消息数 |
| PATCH | `/api/monitor/messages` | 批量标记已读 |
| DELETE | `/api/monitor/messages` | 清空消息 |
| GET (SSE) | `/api/monitor/events` | 实时推送触发事件 |

**`market`**：`A`（A 股 + 场内 ETF）/ `HK`（港股）

**`period`**：`timeshare` `1min` `5min` `15min` `30min` `60min` `daily` `weekly`

---

## License

MIT
