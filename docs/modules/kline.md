# 后端 KlineService + 缓存层

> 本文档是 [AGENTS.md](../../AGENTS.md) 的卫星文档，承载 K 线数据源选型、`KlineService` 路由逻辑与缓存策略。改动数据源、周期路由或 TTL 时**同步更新本文件**。
>
> K 线图前端组件（`KLineChart`）约定见 [frontend.md](./frontend.md)；接口层指标计算（MACD/MA/BOLL/RSI/attrs）见 [strategies.md 指标计算](../strategies.md#指标计算接口层统一口径)。

---

## 后端 `KlineService`

- **数据源选型**：东方财富 push2his 按 IP 强限流（几次请求即拒连），新浪 getKLineData 不支持复权——二者均不适合做 K线主源；改用**腾讯财经 ifzq**（原生支持前复权、抓取宽松、国内直连）。`fetchBars` 按周期/市场路由：
  - **日/周线**（需前复权）：A股/ETF 与港股均走腾讯 `web.ifzq.gtimg.cn/appstock/app/fqkline/get`（`param=symbol,day|week,,,500,qfq`）。返回中 A股/ETF 取 `qfqday`/`qfqweek` 键，港股取 `day`/`week` 键（港股日线行尾附带分红对象，解析时忽略）
  - **分时/分钟线**（不复权，与原行为一致）：A股/ETF 走腾讯 `ifzq.gtimg.cn/appstock/app/kline/mkline`（周期码 `m1/m5/m15/m30/m60`，分时用 `m1`）；港股腾讯不提供分钟线，仍走 **Yahoo Finance** `query1.finance.yahoo.com/v8/finance/chart`
  - **拉取根数**：日/周线 fqkline 取 500 根；分钟线 mkline 取 **800 根**（该接口有 800 根硬上限，请求 >800 会静默回退到默认 320 根，故取满 800 以最大化日内历史）。注意分钟线历史上限受此 800 根所限：15min≈最近 50 个交易日、30min≈近半年、60min≈近 1 年、5min≈近 16 个交易日——回测/查看的可用起点不会早于该窗口，与所选时间区间无关（mkline 不支持按起始日期回溯更早数据）
- 腾讯 symbol 规则：港股 `hk` + 5 位代码（如 `hk00700`）；A股/ETF `6` 或 `5` 开头用 `sh`（沪市，含 51xxxx ETF），其余用 `sz`（深市，含 15xxxx ETF）
- 腾讯每行均为数组 `[时间, 开, 收, 高, 低, 量, ...]`（注意是开-**收**-高-低顺序），由 `parseTencentRows` 统一解析；时间 `YYYY-MM-DD`（日/周）或 `YYYYMMDDHHMM`（分钟，转为 `YYYY-MM-DD HH:MM`）
- 新增市场/周期在 `fetchBars` 路由与对应 `fetch*` 方法内扩展，上层接口不变

---

## 缓存层（`cache.ts`）

- `MemCache<T>`：进程内 TTL 缓存，自动过期，无需外部依赖
- `isTradingMarket(market)`：按市场判断当前是否在交易时段；A股 09:30–11:30、13:00–15:00；HK 09:30–12:00、13:00–16:00
- `isTrading()`：任意市场在交易时段内即返回 true，用于缓存 TTL 守卫（覆盖 HK 最宽窗口 09:30–12:00、13:00–16:00）
- `tradingTtl(tradingMs, offHoursMs)`：交易时段返回短 TTL，盘外返回长 TTL
- K线缓存 TTL：分时/1min 盘中 1min，5min–30min 盘中 3min，60min/日线盘中 5min，周线盘中 10min；**盘外统一 1h**
- 行情缓存 TTL：盘中 30s，盘外 10min
- 基金缓存 TTL（见 [fund.md](./fund.md)）：`getFundInfo` 盘中 30s/盘外 10min，`getFundNav` 盘中 1min/盘外 1h，`getFundHoldings` 固定 1h
