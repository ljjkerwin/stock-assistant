# 策略回测模块（StrategyModule）

> 本文档是 [AGENTS.md](../AGENTS.md) 的卫星文档，承载策略回测的全部细节。新增/修改策略或回测逻辑时，**同步更新本文件**；AGENTS.md 仅保留一句话摘要 + 指针。

---

## 新增策略文档模板

每新增一个策略，在「策略实现」下按以下小节结构追加一节（保持统一，避免各写各的）：

```markdown
### <展示名>（id `<id>`）—— <一行定位>
- **设计定位**：解决什么问题、面向什么周期/标的、由哪个文件实现
- **设计取材**（可选）：借鉴的业界框架/工具及理由
- **入场**：条件（全部用相对量，避免随股价高低失真的绝对阈值）
- **离场**：条件
- **参数集**：常量名 + 个股/ETF 是否分集
- **行为特征**：样本聚合实测结论（区间、标的数、收益/回撤/夏普口径）
- ⚠️ **过拟合/数据窗口提示**（如有）
```

> 凡入场/离场判定，**一律使用相对量**（均线大小关系/斜率、零轴方向、价格对 MA 的乖离比率、百分比斜率、RSI、单日涨跌幅、SAR 与收盘相对位置），不引入随股价高低失真的绝对阈值。

---

## 路由与接口

- 前端路由：`/strategy-backtest/:code`，`code` 为股票代码（如 `600000` 或 `00700`），market 由代码推断
- 后端 `StrategyService` 提供回测接口，支持指定时间区间、K 线周期、回测策略
- 回测结果包含：区间涨跌、回测收益、最大回撤、夏普比率、交易次数、交易详情、带交易信号的 K 线数据
- 交易次数按买卖动作计数（买入一次、卖出一次，即完整交易笔数 × 2，含末根强制平仓的买卖各一次）
- 相关 API 行见 [docs/api.md](./api.md#策略回测)

---

## 分层架构（指标 vs 策略）

- 「股票指标」（MACD/MA/RSI/`attrs`）由**接口层 `KlineService.calcMACD`** 统一计算并随每根 K 线返回，策略层只读消费、不重算
- 「策略信息」（`shouldHold`/`cumulHold`/买卖信号/交易）由各策略自行计算
- `StrategyService.backtest` 是通用 runner：拉取 K 线 → 按区间截取并预热 → 调用策略 → 计算通用回测指标（收益/最大回撤/夏普）。夏普为**净值逐周期收益率的年化夏普**（持仓期按收盘 mark-to-market、空仓期记 0，样本标准差 × 年化因子），非「每笔交易收益率」口径，避免少量交易塌缩分母产出伪值；年化因子按 K 线周期自适应：daily=√252、weekly=√52、日内 Nmin=√(252×每日根数)（A 股 240 分钟/日，如 5min=√(252×48)）

---

## 策略抽象与扩展

- `backend/src/strategy/strategies/` 下：`strategy.interface.ts` 定义 `Strategy` 接口（`readonly id`（稳定标识，注册表键与接口 `strategy` 参数取值，一经确定不可改）、`readonly name`（展示名，可随时改）、`run({ bars, testStartIndex, isEtf })` → `{ trades, signals }`，纯函数）；`StrategyContext.isEtf` 由 `backtest()` 按市场/代码推断（A 市场且代码 1/5 开头视为场内 ETF），供策略切换参数集（如 trend5 的 ETF 专用突破回看），普通策略可忽略该字段；`trend2.strategy.ts`（id `trend2`）、`trend5.strategy.ts`（id `trend5`）、`trend8.strategy.ts`（id `trend8`）为各策略实现；`index.ts` 维护「id→策略实例」注册表，并导出 `listStrategies()`（`{ id, name }[]`）供接口层
- **新增策略**：实现 `Strategy` 接口（含唯一 `id` 与 `name`）并在 `index.ts` 的 `STRATEGIES` 数组注册即可，`backtest()`、controller 与前端均无需改动——前端策略下拉通过 `GET /api/strategy/list` 动态获取
- **改策略名**：只改对应策略实现的 `name` 字段；`id` 不变，已存的回测配置与缓存不受影响（用 id 识别，不会因改名失效）

### 通用约定

> **末根强制平仓（`forcedClose`）**：回测结束仍持仓时以最后一根收盘价平仓，盈亏照常计入收益/回撤/夏普/交易次数，但**不在图上标卖出信号、不生成卖出交易记录**（交易记录该笔只保留买入行）。各趋势策略均遵循此约定。
>
> **`cumulHold` 口径**：当前 K 线之前连续 `shouldHold` 为 true 的根数，不含自身、遇 false 归零（`cumulHold[i] = shouldHold[i-1] ? cumulHold[i-1] + 1 : 0`，首根为 0，目前仅返回、前端暂不绘图）。

---

## 策略实现

### 日线趋势策略2（id `trend2`）—— 自适应双模式（趋势骑乘 + 反弹）

- 设计定位：单一固定策略无法同时应对「强趋势单边上涨」与「震荡/阴跌」，故 v2 内置行情识别，按当前 K 线自动切换两种模式（两模式以 MACD 零轴方向天然互斥，同一根优先判定趋势模式）；由 `trend2.strategy.ts` 实现
- 趋势成熟度指标 `TAR = MA20/MA60`（中期均线相对长期均线的位置），用于评估趋势/下跌的严重程度，给两种模式各加一道「极端行情」门槛（仅在 MA60 可用时生效）
- **趋势骑乘模式**（强趋势，吃主升浪）：入场需 `MA5 > MA10 > MA20`（多头排列）且 `close > MA10` 且 `MA10` 拐头向上且当日上涨且 `dif > dea` 且 `dif > 前一日 dif` 且 `dif > 0`（零轴上方走强），并通过**强趋势闸门**——价格乖离 `close/MA20 ≥ EXT_GATE`（默认 1.06）且 MA20 日斜率 `(MA20/前一日MA20 - 1)×100 ≥ SLOPE_GATE_PCT`（默认 0.6）、且 `TAR ≤ TAR_OVERHEAT_MAX`（默认 1.10，趋势未过热）；出场 `close < MA10`
- **反弹模式**（震荡/阴跌后的底部反转，快进快出）：入场需 `close > MA10` 且 `close > MA20` 且 `MA5 > MA10` 且 `MA10` 拐头向上且当日上涨且 `dif > dea` 且 `dif > 前一日 dif` 且 `dif < 0`（零轴下方金叉）且 `RSI6 ∈ [REBOUND_RSI_MIN, REBOUND_RSI_MAX)`（默认 [55, 70)，反弹需有真实力度——既不接弱势死猫跳、也不追超买）、且 `TAR ≥ TAR_SEVERE_MIN`（默认 0.90，下跌不至过于严重，避免接飞刀）；出场 `close < MA5`
- 开仓时记录模式，平仓按对应模式的出场条件（趋势→跌破 MA10、反弹→跌破 MA5）；买卖互斥，不在同根触发
- 随 K 线返回的策略字段：`shouldHold` 在 v2 定义为「趋势向上的可持仓状态」（`close > MA10 && MA5 > MA10`）；末根强制平仓与 `cumulHold` 口径见上文通用约定
- 可调参数 `EXT_GATE`/`SLOPE_GATE_PCT`/`REBOUND_RSI_MIN`/`REBOUND_RSI_MAX`/`TAR_OVERHEAT_MAX`/`TAR_SEVERE_MIN` 为 `trend2.strategy.ts` 顶部常量；所有入场条件均为**与价格刻度无关**的相对量
- ⚠️ **过拟合提示**：v2 的多个参数是在少量标的、单一区间上调出来的，27 只标的 × 多区间的样本外验证显示其聚合表现一般（训练窗中位数为负、牛市大幅跑输买入持有）。追求样本外稳健请优先用 `经典框架-趋势跟随+分层止损+趋势确认`（id `trend5`）

### 经典框架-趋势跟随+分层止损+趋势确认（id `trend5`）—— Donchian 突破入场 + 棘轮三段止损 + MA60 斜率确认（多区间样本调优的稳健版）

- 设计定位：以业界经典趋势跟随框架（regime 过滤 + Donchian 突破 + 阳线入场）为底，把出场换成棘轮三段止损、入场加趋势确认，并区分个股/ETF 两套参数；由 `trend5.strategy.ts` 实现，经 `scripts/batch-backtest.mjs`（64 标的 × 4 区间）多 regime 样本调优。已用 27 只标的 × 多区间样本外验证
- **棘轮式三段止损**（止损位只升不降）：① 初始止损 `买价 − initMult×ATR(入场日)`；② 保本止损——浮盈达 `breakevenMult×ATR(入场日)` 后止损上移到买入价；③ ATR 跟踪止损（chandelier）`峰值收盘 − trailMult×ATR(当日)`；三者取最高，收盘跌破即离场
- **入场加趋势确认（核心）**：样本暴露最大失血点在**下跌市 whipsaw**（regime `close>MA60 && MA20>MA60` 在下跌初期/中继反弹仍成立，反复买突破被切），故额外要求 **MA60 自身上行**（`ma60[i] > ma60[i − ma60SlopeLookback]`，默认 10 日）；下跌市 MA60 走平/向下时整段空仓。抗过拟合（相对量、无绝对阈值），代价是上涨初期入场略滞后
- **双参数集**：参数以 `STOCK_PARAMS` / `ETF_PARAMS` 两套常量组织在 `trend5.strategy.ts` 顶部（字段 `breakoutLookback`/`atrPeriod`/`initMult`/`breakevenMult`/`trailMult`/`ma60SlopeLookback`），`run()` 按 `ctx.isEtf` 选用。个股：突破 20、初始 2×、保本 1×、跟踪 **3.5**×ATR、斜率 10；ETF：**仅把突破回看 20→40**（低波动篮子假信号多，要求更强趋势确认），其余与个股一致——经 ETF 子样本验证优于更长(50+)/更短(30)或额外放宽止损
- **趋势过滤与突破入场**：仅在 `close > MA60` 且 `MA20 > MA60`（中期趋势向上）的 regime 下做多，且收盘创近 `breakoutLookback` 日新高（Donchian 突破）并当日上涨才入场；ATR(14, Wilder 平滑)、近 N 日最高收盘由策略在 bars 序列上自算（依赖回测预热区间），MA/changePercent 取自接口层
- `shouldHold`（=中期上升趋势状态 `close > MA60 && MA20 > MA60`）/`cumulHold`、末根强制平仓见上文通用约定
- **行为特征（样本聚合，64×4 区间）**：收益中位 −0.31%、收益均值 0.81%、回撤中位 3.55%、夏普中位 0.00，**现有策略中各项聚合指标最优**；价值在下跌/震荡市的回撤保护，单边上涨市参与但滞后买入持有（只做多趋势跟随的固有特征）

### 抛物线趋势骑乘（id `trend8`）—— 趋势骑乘入场 + 自适应 Parabolic SAR 离场 + 高潮反转日离场（独立框架，非 trend5 迭代）

- 设计定位：针对「先沿趋势骨缓慢上行 → 走着走着加速大涨（抛物线/主升浪）→ 冲到高点后快速回落」的题材/趋势股，目标是吃满整段趋势（含末端垂直拉升）同时在顶部尽早离场、少回吐（利益最大化）；由 `trend8.strategy.ts` 实现，与 trend5 共用接口层指标但**框架完全独立**（不用 Donchian 突破 / ATR 棘轮）
- 设计取材：业界对「blow-off top」的公认离场工具是 **Welles Wilder 的 Parabolic SAR**——加速因子（AF）随价格每创新高递增，趋势越陡止损位收得越快，相当于「随趋势成熟自动加速上移的动态地板」，能在抛物线顶部附近贴住价格、先于滞后的均线/ATR 离场
- **入场（趋势骑乘式，非突破）**：中期趋势骨向上（`close>MA20>MA60` 且 `MA60` 上行，`ma60[i] > ma60[i−ma60SlopeLookback]`）+ 多头排列站上最快均线（`MA5>MA10` 且 `close>MA5`）+ 当日阳线 + MACD 零轴上方多头（`dif>dea` 且 `dif>0`）
- **离场（两道，取先触发）**：① **自适应 Parabolic SAR**：入场时 SAR 初始化为近 `sarInitLookback` 根最低价，EP=入场日最高价，AF 从 `afStart` 起每创新高 +`afStep`；钳制 `SAR ≤ min(前两根最低价)`（Wilder 规则）；当**抛物线过热**（自入场以来峰值相对 MA20 乖离 ≥ `extGatePct`）时把 AF 上限由 `afMaxBase` 抬到 `afMaxHot`，使主升浪末端止损收得更紧；收盘跌破当日 SAR 即离场。② **高潮反转日**（同日落袋，抢在 SAR 之前）：过热状态下当日跌幅 ≥ `climaxDropPct` 且阴线，即当日收盘离场（SAR 以「收盘<当日 SAR」判定，对「创新高后当日暴力反转」天然滞后一根，故单设此即时离场）
- 所有判定均为相对量（均线大小关系/斜率、价格对 MA20 乖离比率、单日涨跌幅、SAR 与收盘相对位置），无随股价高低失真的绝对阈值
- 参数集见 `trend8.strategy.ts` 顶部 `STOCK_PARAMS`/`ETF_PARAMS`（字段 `ma60SlopeLookback`/`afStart`/`afStep`/`afMaxBase`/`afMaxHot`/`sarInitLookback`/`extGatePct`/`climaxDropPct`；ETF 集过热/高潮阈值相应放低，仅用于泛化）；`shouldHold`（中期上升趋势状态）/`cumulHold`/末根强制平仓口径与其他趋势策略一致
- **行为特征（「高点处理」38 标的 × 2026 区间实测）**：收益中位优于 trend5（如 2026-01-13~06-18 区间收益中位 25.87 vs trend5 13.88；2026-04-01~06-18 区间 26.54 vs 17.77），夏普中位亦最高；对「暴力 blow-off」标的提升显著（贴顶离场），代价是对「长多浪」标的会更早离场、回撤中位偏高（属「锁定主升浪、少回吐」定位的固有取舍）

### 15分钟·趋势自适应（id `pullback15`）—— 上升趋势过滤 + regime 自适应双模式入场（回调金叉 / 强趋势 onset 骑乘）+ 趋势持有·确认破位才离场

- 设计定位：面向 **15min K 线**的多周期趋势策略，帮助判断 A 股标的的短波段买卖点；由 `pullback15.strategy.ts` 实现，与其他策略共用接口层指标。用「慢周期代理」（15min 上的 MA60 ≈ 近 4 个交易日中枢）定方向，只在中期上升趋势中做多，并**按趋势强弱切换两种入场**：普通趋势用「趋势内回调金叉」，强趋势用「多头排列铺开首根骑乘」，之后趋势持有、确认破位才离场
- **趋势过滤（regime，复用 trend5 口径）**：`close>MA60 && MA20>MA60 && MA60 上行`（`ma60[i] > ma60[i − MA60_SLOPE_LOOKBACK]`，默认 16 根 ≈1 交易日），下跌/走平市整段空仓
- **入场（两模式，取先满足）**：
  - **① 回调金叉（普通上升趋势）**：regime 成立 + MACD 金叉（`dif` 上穿 `dea`）+ 当日阳线（`changePercent>0`）+ RSI6 未超买（`< RSI_OVERBOUGHT`，默认 75）。**不要求 `dif>0`**——regime 已保证趋势向上，零轴下方的较深回调金叉恰是好买点；RSI 上限用于在震荡/普通趋势里避免追高接最后一棒
  - **② 强趋势 onset 骑乘（强趋势）**：在**强趋势** `isStrongUp`（`MA5>MA10>MA20>MA60` 且 MA60 上行 且 `close>MA20`）**刚由假转真的那一根（onset）** + MACD 多头（`dif>dea`）即入场，**放开 RSI 上限、不要求新鲜金叉/阳线**。修复点：强趋势单边上行时 MACD 一路 `dif>dea` 不再产生新鲜金叉、RSI6 长期 80+ 被超买上限挡死，原单一回调金叉入场整段主升浪一笔进不去（实测 600498 烽火通信 +64% 区间，6 月 +34% 拉升的每个金叉都因 RSI6≈82~84 被否决，原策略 −2.45%）。**onset-only** 是关键：若改为「strongUp 期间每根阳线都入」会在震荡市被「入场→破位离场→又追进」千刀万剐（实测震荡段收益中位 0.00→−0.57），onset 后被洗出须待趋势重新走强才再入场，既保住震荡保护（中位回 0.00）又能在主升浪里再入场吃趋势
- **离场（趋势持有，确认破位才卖，取先触发）**：①**连续 2 根 15min 收盘跌破 MA20**（过滤单根噪声，穿越趋势的小回调不离场）；②**趋势破位** `MA20 < MA60`（中期结构走坏）。`isStrongUp` 要求 `close>MA20`，故强趋势持有期不会触发跌破 MA20 离场。早期版本用「MACD 死叉 或 单根跌破 MA20」的对称信号离场，实测在 15min 上过于灵敏，故改为趋势持有式离场；买/卖互斥、不在同根触发
- **多周期日线趋势闸（MTF，「日线定方向、日内定点位」）**：在 15min 自身 regime 之上再叠一层日线判断。日线状态由 **service 层** 计算并随每根日内 K 线附加为 `dailyUp`/`dailyStrongUp`/`dailyDown`（口径同上放到日线：`dailyUp`=中期上行 regime、`dailyStrongUp`=多头排列充分、`dailyDown`=`MA20<MA60` 明确下行，既非 up 也非 down 即「走平」regime），**取该交易日【上一交易日】收盘的日线状态以防未来函数**（对齐与二分见 `strategy.service.ts` 的 `attachDailyTrend`/`computeDailyTrendStates`，日线 MA60 斜率回看 `DAILY_SLOPE_LOOKBACK`=5）。两条作用：①**趋势闸（宽松口径）**——只在 `dailyDown` 时不发买点，**放行走平/上行 regime**（既挡日线阴跌中的 15min 抄底，又保留震荡/筑底段的反弹机会；更严的「必须 `dailyUp` 才放行」会把走平段一并空仓，偏熊窗口更稳但牺牲机会，故默认用宽松口径）；②**强上行骑乘保护**——`dailyStrongUp` 时把 15min「连续 2 根跌破 MA20」的软离场视为趋势内噪声而忽略，仅保留 15min 结构破位（`MA20<MA60`）的硬离场。仅日内周期回测时由 service 附加；**daily 周期或日线数据缺失时整列为 undefined，策略自动回退为纯 15min 单周期行为**（向后兼容）
- 参数集为 `pullback15.strategy.ts` 顶部常量 `MA60_SLOPE_LOOKBACK`/`RSI_OVERBOUGHT`（仅 2 个，**刻意不精调**；强趋势 onset 入场为纯结构判定、无新增拟合阈值）；不区分个股/ETF（忽略 `ctx.isEtf`）；`shouldHold`（中期上升趋势状态）/`cumulHold`/末根强制平仓口径与其他趋势策略一致；所有判定均为相对量，无随股价高低失真的绝对阈值
- **行为特征（15min 固定测试集 33 标的 × 3 区间）**：相比单模式旧版，总体收益中位 0.00→0.35、均值 1.00→2.52、空仓率 19%→2%；震荡段（W_chop）收益中位维持 0.00（下跌保护未退化），拉升段（W_rally）收益中位 0.00→1.09、夏普 0.00→1.00；代价是回撤中位 1.31→2.84。单只 600498 −2.45%→+42.4%
- **MTF 日线趋势闸迭代行为特征（收藏夹 13 标的 × 2026-04-08~06-25 偏熊窗口；与「无闸」「严闸」三版对比）**：均值收益 无闸 2.95% → 严闸（必须 `dailyUp`）5.45% → **宽闸（只挡 `dailyDown`，默认）6.38%**；总交易动作 194 → 36 → 44（换手大幅下降、每笔质量提升）；空仓率 0 → 10/13 → 8/13。两个核心修复一致：①日线强单边里靠**骑乘保护**把被 15min churn 洗成负的标的救回（中富电路 日线 +111%：−19.9%→+18.4%）；②日线阴跌标的被**趋势闸**挡成 0（那批下跌 ETF 的小亏归零）。宽闸相对严闸的增量来自走平/筑底段：昊华科技 39.3%→52.8%、恒生科技ETF 0→+1.4%，代价是偶有小亏（格林精密 0→−2.8%）——综合更优故定为默认
- ⚠️ **数据窗口约束**：15min 分钟线上游最多 ~800 根 ≈ 最近 50 个交易日且不可回溯（见 [docs/modules/kline.md](./modules/kline.md)），故本策略只能在该窗口内回测、**无法做日线那种多区间样本外验证**；参数少、不精调、入场判定纯结构即为压制此约束下的过拟合。专用测试集与对比工具见 `scripts/backtest15.mjs`（见 [AGENTS.md 常见任务指引](../AGENTS.md#常见任务指引)）

---

## 指标计算（接口层统一口径）

- MACD(12,26,9)（标准参数，全项目统一）、MA5/10/20/60、BOLL(20,2)、RSI 均在 `KlineService.calcMACD` 计算后随每条 K 线返回，回测层直接消费、不重算，故回测信号与 K 线图指标完全一致
- 每根 K 线附带 `changePercent` 字段（当日涨跌幅 %，相对前一根 K 线收盘价，保留两位小数；首根无前收为 null），在 `KlineService.calcMACD` 中统一计算，回测接口的 K 线数据同样携带
- BOLL(20,2) 以 `boll` 对象返回（`upper`/`mid`/`lower`，均 `number | null`）：中轨 = 20 周期 SMA（即 MA20），上/下轨 = 中轨 ± 2×总体标准差（除数为 N，通达信/同花顺口径），窗口不足 20 根时三轨为 null；目前仅 K 线图主图「BOLL」叠加使用
- RSI 以 `rsi` 对象返回，目前仅含 `rsi6`（6 周期，通达信口径 Wilder 平滑 `RSI = avgGain/(avgGain+avgLoss)*100`，首根 K 线无前收返回 null），其他周期需要时再扩展

---

## 前端回测页

- 标题栏右侧提供收藏（星标）按钮，复用 `favoritesStore`（`addStock`/`removeStock`）；标题展示股票名称（`stocksApi.getInfo` 获取，缺失时回退为代码）
- localStorage 缓存：回测配置以**全局单条「最近一次回测配置」**存储（key `backtest:params`，不按股票分组），刷新或切换股票时自动套用（market 不入缓存，由代码推断）；回测结果以 `backtest:result` 缓存（key 含 `code|market|period|strategy|startDate|endDate`），仅当当前股票 + 配置与缓存完全一致时回填并显示「已缓存」标签
- K 线图复用 `KLineChart` 组件：**回测前即展示**——未回测时以拉取模式按所选周期渲染 K 线（含均线/BOLL/MACD/RSI/ljj 副图），仅不渲染买卖点（普通 K 线无 `signal` 字段），周期通过受控 `period` prop 由页面下拉驱动、随交易时段自动轮询；回测后改用 `initialData` 传入回测返回的 K 线数据（叠加买卖信号与回测起始标记）并禁用自动轮询。`KLineChart` 的 `period` prop 为拉取模式下的外部受控周期（配合 `showPeriodTabs=false`），有 `initialData` 时以其 `period` 为准
- **回测前预览视口对齐回测区间**：回测页通过 `viewStartDate`/`viewEndDate`（YYYY-MM-DD）prop 把当前表单的开始/结束时间传给拉取模式的预览图，预览默认视口取 `[viewStartDate−5根, viewEndDate]`（与回测结果视图同样前留 5 根历史上下文），**优先于持久化 zoom**；表单时间区间变化时就地重新取景（不重新拉取），从而点击「开始回测」后视口不跳到别的时间。该 prop 仅在无 `initialData` 的拉取模式下生效

### K 线图副图（仅回测页启用）

- `showRsi`：常规 RSI 副图，只画 RSI6（6 个交易日）曲线，数据取 K 线的 `rsi.rsi6`
- `showLjj`：「ljj」自定义副图，用堆叠柱状图展示每根 K 线满足的综合属性数（每满足一个属性柱高 +1，不同属性不同色）
  - 属性在后端计算，随每根 K 线以 `attrs` 对象返回（布尔字段 `kmacd`/`krsi`/`kma`），由 `KlineService` 导出的纯函数 `computeKlineAttrs(bar, prevDif)` 在 `calcMACD` 中统一计算（回测层直接复用）
  - 属性定义（按堆叠优先级自底向上）：
    - **KMACD**（橙色，柱底）：`dif > 0` 且 `macd.dif - macd.dea > -0.1`（DIF 接近或高于 DEA）且 DIF 上升（`dif[i] - dif[i-1] > -0.06`，允许 0.06 以内微跌）
    - **KRSI**（蓝色，中部）：`rsi.rsi6 >= 50`
    - **KMA**（绿色，顶部）：`close > ma10` 且 `ma5 / ma10 > 0.995`
  - 渲染：用 3 个 Histogram series 叠加模拟堆叠（lightweight-charts 无原生堆叠）——先画整柱(顶段色)，再依次覆盖较矮的中段、底段露出各色带；副图 legend 显示 `KMACD/KRSI/KMA` 的 ✓/✗
