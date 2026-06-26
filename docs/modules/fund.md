# 基金模块（FundModule）

> 本文档是 [AGENTS.md](../../AGENTS.md) 的卫星文档。改动基金数据源、净值/持仓解析或缓存时**同步更新本文件**。接口行见 [docs/api.md 基金](../api.md#基金)。

---

- 路由：`/fund/:code`，`code` 为基金代码（如 `000001`），无 market 参数
- 搜索数据源：东方财富 `fund.eastmoney.com/js/fundcode_search.js` 全量基金列表（约 2 万条），首次加载后进程内缓存 24h，`searchFunds` 在内存中过滤返回前 10 条，单次搜索结果仍缓存 5min
- 净值数据源：东方财富 `lsjz` API（历史净值）+ `fundgz.1234567.com.cn` JSONP API（实时估值）；lsjz 单页实际上限为 20 条，`getFundNav` 按 `limit` 自动分页并发拉取
- 三个接口并发请求，任一失败均降级处理（估值不可用时不展示估值字段；规模/成立日期不可用时不展示对应字段）
- 规模、成立日期通过抓取 `fundf10.eastmoney.com/jbgk_${code}.html` 并正则提取，失败时降级为 null
- 历史净值接口返回最新在前，`FundService` 反转为时间正序供图表使用
- Sidebar 顶端 Select 切换股票/基金模式，模式由当前 URL 路径决定（`/fund/*` → 基金模式，其余 → 股票模式）；切换时分别导航到 `/stock` 或 `/fund`；`/` 重定向到 `/stock`
- `NavChart` 组件：Lightweight Charts 折线图，仅展示单位净值（蓝色）一条线；时间区间通过 `limit` 参数控制（1M=25/3M=70/6M=135/1Y=255/3Y=760/ALL=1000）
- 缓存 TTL：`getFundInfo` 盘中 30s，盘外 10min；`getFundNav` 盘中 1min，盘外 1h；`getFundHoldings` 固定 1h（季报数据变化频率低）

## 持仓数据

- 持仓数据源：`fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc`，返回 JS 变量，解析其中 content HTML；先取当年，不足三期则补拉上一年；最多返回最近三期
- 持仓表格列结构因季报新旧而不同，同一基金不同期的列数和列顺序均可能不同；`detectRatioIdx` 方法扫描每个 block 的表头行，定位含"净值"文本的列索引，从而精准读取占净值比例，不依赖固定列号
- `FundHolding` 字段：`rank`、`code`、`name`、`latestPrice`（最新价，number|null）、`marketValue`（占净值比例 %，number|null）

## 调试

- 基金净值从东方财富 `https://api.fund.eastmoney.com/f10/lsjz` 拉取，实时估值从 `https://fundgz.1234567.com.cn/js/{code}.js` 拉取；逻辑在 `backend/src/fund/fund.service.ts`。基金详情页路由为 `/fund/:code`，直接在浏览器地址栏访问即可
