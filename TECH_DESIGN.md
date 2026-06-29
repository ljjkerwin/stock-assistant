# 股票助手技术设计文档

## 技术栈

| 层级 | 技术选型 |
|------|---------|
| 前端框架 | React 19 + Vite |
| 前端语言 | TypeScript |
| UI 组件库 | Ant Design |
| K线图库 | Lightweight Charts (TradingView) |
| 前端状态管理 | Zustand |
| 后端框架 | Node.js + NestJS |
| 数据存储 | SQLite（通过 TypeORM） |
| 股票数据源 | 东方财富（搜索 + 行情）；K线：腾讯财经（A股/ETF 全周期 + 港股日/周线，日/周线前复权）+ Yahoo Finance（港股分时/分钟线） |

---

## 系统架构

```
┌─────────────────────────────────────────┐
│              前端 (React + Vite)         │
│  ┌──────────┐  ┌────────────────────┐   │
│  │  收藏栏  │  │    股票详情页       │   │
│  │ Sidebar  │  │  K线图 + 股票信息  │   │
│  └──────────┘  └────────────────────┘   │
└──────────────────┬──────────────────────┘
                   │ HTTP / REST API
┌──────────────────▼──────────────────────┐
│           后端 (NestJS)                  │
│  ┌──────────────────────────────────┐   │
│  │         API Router               │   │
│  │  /stocks  /kline  /favorites     │   │
│  └──────────────┬───────────────────┘   │
│  ┌──────────────▼───────────────────┐   │
│  │       数据服务层 (Service)        │   │
│  │  StocksService  KlineService     │   │
│  └──────┬──────────┬────────────────┘   │
│         │          │  MemCache (TTL)     │
│  ┌──────▼──────┐ ┌─▼──────────────────┐ │
│  │   SQLite    │ │    外部数据源       │ │
│  │ (收藏/配置) │ │ 东方财富(搜索/行情)│ │
│  │             │ │ 腾讯(K线前复权)    │ │
│  │             │ │ Yahoo(港股分钟)    │ │
│  └─────────────┘ └────────────────────┘ │
└─────────────────────────────────────────┘
```

---

## 目录结构

```
stock-assistant/
├── frontend/                   # React 前端
│   ├── src/
│   │   ├── components/
│   │   │   ├── Sidebar/        # 收藏栏组件
│   │   │   ├── KLineChart/     # K线图公共组件（封装 Lightweight Charts）
│   │   │   └── StockSearch/    # 股票搜索组件
│   │   ├── pages/
│   │   │   ├── Home/           # 首页
│   │   │   └── StockDetail/    # 股票详情页
│   │   ├── store/              # Zustand 状态管理
│   │   │   └── favoritesStore.ts
│   │   ├── api/                # API 请求封装
│   │   │   └── stock.ts
│   │   └── types/              # TypeScript 类型定义
│   └── vite.config.ts
│
└── backend/                    # NestJS 后端
    ├── src/
    │   ├── stocks/
    │   │   ├── stocks.controller.ts   # 股票搜索、信息接口
    │   │   ├── stocks.service.ts      # 股票数据逻辑
    │   │   └── stocks.module.ts
    │   ├── kline/
    │   │   ├── kline.controller.ts    # K线数据接口
    │   │   ├── kline.service.ts       # K线数据统一封装
    │   │   └── kline.module.ts
    │   ├── favorites/
    │   │   ├── favorites.controller.ts  # 收藏夹 CRUD 接口
    │   │   ├── favorites.service.ts
    │   │   ├── favorite.entity.ts       # TypeORM 实体
    │   │   └── favorites.module.ts
    │   ├── cache.ts                   # MemCache + tradingTtl（交易时段感知 TTL）
    │   ├── app.module.ts              # 根模块，配置 TypeORM + SQLite
    │   └── main.ts                    # NestJS 入口
    └── package.json
```

---

## 数据库设计

### favorites（收藏夹）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| code | TEXT | 股票代码，如 `600519`、`00700` |
| market | TEXT | 市场：`A`（A股）/ `HK`（港股） |
| name | TEXT | 股票名称 |
| sort_order | INTEGER | 排序序号（越小越靠前） |
| pinned | BOOLEAN | 是否置顶 |
| created_at | DATETIME | 添加时间 |

---

## API 接口设计

### 收藏夹

```
GET    /api/favorites              # 获取收藏列表（按 pinned desc, sort_order asc）
POST   /api/favorites              # 添加股票到收藏
DELETE /api/favorites/{id}         # 删除收藏
PATCH  /api/favorites/{id}         # 更新排序/置顶状态
```

### 股票搜索

```
GET /api/stocks/search?q={keyword}  # 按代码或名称搜索（A股 + 港股）
GET /api/stocks/{market}/{code}     # 获取股票基本信息
```

**`GET /api/stocks/{market}/{code}` 返回结构：**
```json
{
  "code": "600519",
  "name": "贵州茅台",
  "market": "A",
  "price": 1730.0,
  "change_pct": 1.23,
  "turnover": 2345678900,
  "market_cap": 2173000000000,
  "pe": 28.5
}
```
> 字段为非必填，数据源无法提供时返回 `null`。

### K线数据

```
GET /api/kline/{market}/{code}?period={period}

period 枚举值：
  - timeshare   分时
  - 1min        1分钟
  - 5min        5分钟
  - 15min       15分钟
  - 30min       30分钟
  - 60min       60分钟
  - daily       日线
  - weekly      周线
```

**返回数据结构：**
```json
{
  "code": "600519",
  "name": "贵州茅台",
  "market": "A",
  "period": "daily",
  "data": [
    {
      "time": "2024-01-02",
      "open": 1700.0,
      "high": 1750.0,
      "low": 1695.0,
      "close": 1730.0,
      "volume": 12345678,
      "changePercent": 1.76,
      "macd": { "dif": 5.2, "dea": 3.1, "bar": 4.2 },
      "ma": { "ma5": 1720.0, "ma10": 1710.0, "ma20": 1700.0, "ma60": 1680.0 },
      "rsi": { "rsi6": 62.5 },
      "attrs": { "kmacd": true, "krsi": true, "kma": false }
    }
  ]
}
```

---

## K线图组件设计

KLineChart 是全局公共组件，接受以下 props：

```typescript
interface KLineChartProps {
  market: 'A' | 'HK'
  code: string
}
```

组件内部维护：
- 当前选中的时间维度（默认分时）
- 数据请求与加载状态
- Lightweight Charts 实例（主图 + 副图成交量/MACD）

**主图渲染规则：**
- 分时图：折线图（价格线）
- 其他周期（1min/5min/.../weekly）：蜡烛线

**副图指标：**
- 成交量：柱状图，涨红跌绿
- MACD 参数：短期 12、长期 26、信号 9（即 MACD(12,26,9)，标准参数，全项目统一）

**十字线 legend：**
- 主图、成交量副图、MACD 副图各有一个 legend 条，悬浮在图区左上角
- 鼠标移入任意图区，三个图的 legend 同步更新至当前十字线对应 bar 的值
- 主图显示开/高/低/收（分时图显示价格），量图显示 VOL，MACD 图显示 DIF / DEA / MACD 柱
- 实现方式：`applyData` 将 bars 存入 `barsRef`，`initCharts` 内定义 `updateAllLegends(time)` 按时间查表，三个图的 `subscribeCrosshairMove` 回调均优先调用此函数再执行跨图十字线同步

**数据刷新策略：**
- 刷新间隔：30 秒轮询
- 仅在对应市场交易时段内自动刷新，收盘后停止轮询

---

## 后端 K线服务统一封装

`KlineService` 屏蔽不同市场/周期的数据源差异，对上层提供统一接口。`fetchBars` 按周期与市场路由数据源：

```typescript
@Injectable()
export class KlineService {
  private klineCache = new MemCache<KlineBar[]>();

  async getKline(market: 'A' | 'HK', code: string, period: string): Promise<KlineBar[]> {
    // 先查缓存
    const cached = this.klineCache.get(`${market}:${code}:${period}`);
    if (cached) return cached;

    const raw = await this.fetchBars(market, code, period);
    const bars = this.calcMACD(raw)          // 统一在后端计算 MACD(12,26,9)
    this.klineCache.set(key, bars, tradingTtl(t, o));
    return bars;
  }

  private fetchBars(market, code, period) {
    // 日/周线（需前复权）：A股/ETF 与港股均走腾讯 fqkline（qfq）
    if (period === 'daily' || period === 'weekly') return this.fetchTencentFq(market, code, period);
    // 分时/分钟线（不复权）：A股/ETF 走腾讯 mkline，港股走 Yahoo
    return market === 'A' ? this.fetchTencentMin(code, period) : this.fetchYahoo(code, period);
  }
}
```

数据源选型与细节：
- **为何不用东方财富/新浪**：东方财富 push2his 按 IP 强限流（几次请求即拒连），新浪 getKLineData 不支持复权——故 K线主源改用**腾讯财经 ifzq**（原生前复权、抓取宽松、国内直连）
- **日/周线（前复权）**：腾讯 `web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=symbol,day|week,,,500,qfq`；A股/ETF 取返回的 `qfqday`/`qfqweek`，港股取 `day`/`week`（港股日线行尾附带分红对象，忽略）
- **分时/分钟线（不复权）**：A股/ETF 腾讯 `ifzq.gtimg.cn/appstock/app/kline/mkline`（周期码 `m1/m5/m15/m30/m60`，分时用 `m1`）；港股腾讯不提供分钟线，走 Yahoo `query1.finance.yahoo.com/v8/finance/chart`
- 腾讯 symbol：港股 `hk`+5 位（`hk00700`）；A股/ETF 沪市（`6`/`5` 开头）`sh`、深市 `sz`
- 腾讯每行均为数组 `[时间, 开, 收, 高, 低, 量, ...]`（开-收-高-低顺序），`parseTencentRows` 统一解析

MACD 指标在后端统一计算后随 K 线数据一并返回，前端无需自行计算。

---

## 缓存策略

### MemCache

进程内 TTL 缓存（`backend/src/cache.ts`），无外部依赖，按 key 存储，过期自动失效。

### 交易时段感知 TTL

`tradingTtl(tradingMs, offHoursMs)`：UTC+8 工作日 09:30–12:00、13:00–16:00 期间返回短 TTL，其余时间返回长 TTL，覆盖 A股与港股交易时段。

### 各接口 TTL 配置

| 接口 | 盘中 TTL | 盘外 TTL |
|------|----------|----------|
| 股票行情（`/stocks/:market/:code`） | 30s | 10min |
| K线 timeshare / 1min | 1min | 1h |
| K线 5min / 15min / 30min | 3min | 1h |
| K线 60min / daily | 5min | 1h |
| K线 weekly | 10min | 1h |

> 盘外 TTL 统一为 1 小时，不再按周期阶梯区分。

---

## 前端状态管理

使用 Zustand 管理全局状态：

```typescript
interface FavoritesStore {
  favorites: Stock[]
  selectedStock: Stock | null
  setSelectedStock: (stock: Stock) => void
  fetchFavorites: () => Promise<void>
  addStock: (stock: Stock) => Promise<void>
  removeStock: (id: number) => Promise<void>
  reorderStocks: (ids: number[]) => Promise<void>
  pinStock: (id: number, pinned: boolean) => Promise<void>
}
```

---

## 开发运行

```bash
# 后端
cd backend
pnpm install
pnpm start:dev     # NestJS dev server，默认 3100 端口

# 前端
cd frontend
pnpm install
pnpm dev          # Vite dev server，默认 5173 端口，代理 /api 到 3100
```

---

## 后续扩展点

- **股价监控**：后端增加定时任务（APScheduler），价格到达阈值时推送通知
- **买卖策略回测**：新增回测模块，复用 KlineService 历史数据接口
- **买卖点提示**：在 K 线图上叠加信号标记层
