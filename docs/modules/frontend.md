# 前端约定（K线图 / 列表页 / 状态管理）

> 本文档是 [AGENTS.md](../../AGENTS.md) 的卫星文档，承载前端图表组件、列表页与 Zustand 状态管理的设计约定。改动这些时**同步更新本文件**。
>
> 回测页专属的 K 线副图（RSI / ljj）见 [strategies.md 前端回测页](../strategies.md#前端回测页)。

---

## K线图（`KLineChart` 组件）

- 分时图渲染折线图，其他周期渲染蜡烛线
- 蜡烛线模式下主图右上角有「均线/BOLL」切换按钮，切换主图叠加内容：均线（MA5/10/20/60）或 BOLL(20,2) 布林带（上轨 UP / 中轨 MB / 下轨 DN）；选择状态以全局单值缓存于 localStorage（key `kline:overlay`，取值 `ma`/`boll`），刷新后保持；切换时用当前数据就地重绘（保持视口），不重新拉取；分时模式不显示该按钮。BOLL 三轨数据由后端随 K 线返回（见 [strategies.md 指标计算](../strategies.md#指标计算接口层统一口径)），前端只渲染
- 副图包含成交量（柱状图，涨红跌绿）和 MACD(12,26,9)
- MACD 由**后端计算**后随 K 线数据一并返回，前端不做指标计算
- 每根 K 线附带 `changePercent` 字段（当日涨跌幅 %，相对前一根 K 线收盘价），主图 legend hover 时优先用该字段展示涨跌幅
- 三个图（主图、量图、MACD 图）各有 legend，鼠标在任意图区移动时三者同步更新；`applyData` 将 bars 存入 `barsRef`，`updateAllLegends(time)` 按时间查表统一刷新
- 蜡烛线模式下，主图 legend 在「开/高/低/收」之后展示「当日涨跌幅」（相对前一根 K 线收盘价计算，红涨绿跌；首根 K 线无前收时不展示）
- 30 秒轮询刷新，仅在对应市场交易时段内启用
- K 线图组件是全局复用组件，修改时注意不要破坏其通用性

---

## 股票列表页（`StockListImport` 页面）

- 路由：`/stock-list-import`，Sidebar Section Select 新增「列表」选项切换进入；进入后搜索框与收藏列表隐藏
- 支持导入 Excel（.xlsx/.xls）和 CSV 文件，使用 `xlsx` npm 包解析
- 解析规则：第一行非纯数字（非 4–6 位数字）时识别为表头行；第一列为股票代码，第二列为名称，其余列原样保留；解析使用 `raw: false` 以保留前导零（如 `000858`、`00700`）
- 市场推断：6 位纯数字代码 → A 市场；其余 → HK 市场；用于传给 `HoldingKlinePopup`
- 数据仅展示，不写入数据库
- 名称列 hover 时弹出近 6 个月日 K 线图，复用 `HoldingKlinePopup` 组件（已扩展可选 `market` 参数，默认 `'A'`）
- 表格分页展示（默认每页 50 条），支持切换分页大小

---

## K线总览页（`StockListKline` 页面）

- 路由：`/stock-list-kline`，Sidebar Section Select 新增「K线总览」选项切换进入；进入后搜索框隐藏，列表切换器仍保留（用于切换当前标的列表）
- 展示当前股票标的列表（`currentStockListId`）中所有非基金标的的 K 线图，以卡片网格方式排列
- 顶部工具栏提供**全局周期切换器**（Radio.Group，可选周期：分时/5分/15分/30分/60分/日线/周线），切换后所有卡片同步更新；周期选择缓存于 localStorage（key `stockListKline:period`，刷新后保持）
- 每个 `StockKlineCard` 卡片：最小宽度 400px，`flex: 1` 自适应铺满整行并换行；每张卡片独立请求 K 线数据，包含主图（蜡烛线 + MA5/MA20；分时为面积图）和量图（成交量柱状）；点击标的名称在当前页打开股票详情页
- 标的列表项中 `market === 'FUND'` 的条目不渲染 K 线卡片（基金走净值图，不适合此页面）
- 该页加载时自动拉取暗盘资金（见 [darktrade.md](./darktrade.md)）

---

## 状态管理（Zustand）

- 收藏列表和当前选中股票均通过 `favoritesStore` 管理
- 标的列表（`stockLists`/`fundLists`）及当前选中列表 id（`currentStockListId`/`currentFundListId`）通过 `watchListStore` 管理；当前选中列表 id 按 boardType 分别缓存于 localStorage（key `watchList:current:stock` / `watchList:current:fund`），`fetchLists` 拉取列表后优先沿用已选 id，其次回退到 localStorage 中保存的 id（若仍存在于新列表中），都不满足则回退到 `isDefault` 列表或第一个列表；`setCurrentList`/`createList`/`deleteList` 变更选中列表时同步写入 localStorage，刷新页面后默认展示上次选中的列表
- 监控规则和消息通过 `monitorStore` 管理，规则数据从后端 API 获取（不用 localStorage）
- 组件不直接调用 API，通过 store action 触发请求
