#!/usr/bin/env node
/**
 * 批量回测脚本：收藏夹标的 + 一篮子无偏抽样标的 × 多时间区间 × 全部策略。
 *
 * 目的：用更大、更具代表性的样本，跨多个市场 regime 评估各策略稳健性，
 *       汇报「分布」（中位数 / 胜率 / 分位）而非被极值绑架的均值。
 *
 * 依赖：后端需在 http://localhost:3000 运行（pnpm start:dev）。
 * 用法：node scripts/batch-backtest.mjs
 * 产物：
 *   - all_strategy_result_broad.md   汇总报告（按区间 + 总体 + 分类）
 *   - batch_backtest_raw.csv         每行明细（区间×标的×策略）
 */

import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PERIOD = 'daily';
const CONCURRENCY = 4;

// ── 时间区间：日线数据覆盖 2024-05-28 ~ 2026-06-18 ──────────────────
// 留足约 70 个交易日预热（MA60 / ATR(14) / cumulHold），故最早区间起点取 2024-10。
// 4 段约半年窗口覆盖不同 regime；最后一段沿用旧报告区间以便对比。
export const WINDOWS = [
  { id: 'W1', label: '2024-10-01 ~ 2025-03-31', start: '2024-10-01', end: '2025-03-31' },
  { id: 'W2', label: '2025-04-01 ~ 2025-09-30', start: '2025-04-01', end: '2025-09-30' },
  { id: 'W3', label: '2025-10-01 ~ 2026-03-31', start: '2025-10-01', end: '2026-03-31' },
  { id: 'W4', label: '2026-01-13 ~ 2026-06-18 (旧报告区间)', start: '2026-01-13', end: '2026-06-18' },
];

// ── 新增 50 只无偏抽样标的（不与收藏夹重复）──────────────────────────
// cat = A股大盘 / A股中小盘 / A股小盘科创 / ETF / 港股
export const EXTRA = [
  // A股大盘（沪深300，跨板块）
  { market: 'A', code: '600519', name: '贵州茅台', cat: 'A大盘' },
  { market: 'A', code: '600036', name: '招商银行', cat: 'A大盘' },
  { market: 'A', code: '600900', name: '长江电力', cat: 'A大盘' },
  { market: 'A', code: '600276', name: '恒瑞医药', cat: 'A大盘' },
  { market: 'A', code: '000858', name: '五粮液', cat: 'A大盘' },
  { market: 'A', code: '000333', name: '美的集团', cat: 'A大盘' },
  { market: 'A', code: '600887', name: '伊利股份', cat: 'A大盘' },
  { market: 'A', code: '300750', name: '宁德时代', cat: 'A大盘' },
  { market: 'A', code: '002594', name: '比亚迪', cat: 'A大盘' },
  { market: 'A', code: '600030', name: '中信证券', cat: 'A大盘' },
  { market: 'A', code: '601899', name: '紫金矿业', cat: 'A大盘' },
  { market: 'A', code: '601088', name: '中国神华', cat: 'A大盘' },
  { market: 'A', code: '600028', name: '中国石化', cat: 'A大盘' },
  { market: 'A', code: '002415', name: '海康威视', cat: 'A大盘' },
  { market: 'A', code: '601398', name: '工商银行', cat: 'A大盘' },
  // A股中盘（中证500 量级，跨板块）
  { market: 'A', code: '002241', name: '歌尔股份', cat: 'A中盘' },
  { market: 'A', code: '002714', name: '牧原股份', cat: 'A中盘' },
  { market: 'A', code: '600438', name: '通威股份', cat: 'A中盘' },
  { market: 'A', code: '601633', name: '长城汽车', cat: 'A中盘' },
  { market: 'A', code: '000568', name: '泸州老窖', cat: 'A中盘' },
  { market: 'A', code: '600309', name: '万华化学', cat: 'A中盘' },
  { market: 'A', code: '603259', name: '药明康德', cat: 'A中盘' },
  { market: 'A', code: '002460', name: '赣锋锂业', cat: 'A中盘' },
  { market: 'A', code: '600406', name: '国电南瑞', cat: 'A中盘' },
  { market: 'A', code: '300015', name: '爱尔眼科', cat: 'A中盘' },
  { market: 'A', code: '002230', name: '科大讯飞', cat: 'A中盘' },
  { market: 'A', code: '000725', name: '京东方A', cat: 'A中盘' },
  // A股小盘 / 科创（中证1000 + 科创板，偏科技成长）
  { market: 'A', code: '300274', name: '阳光电源', cat: 'A小盘' },
  { market: 'A', code: '688981', name: '中芯国际', cat: 'A小盘' },
  { market: 'A', code: '688111', name: '金山办公', cat: 'A小盘' },
  { market: 'A', code: '688012', name: '中微公司', cat: 'A小盘' },
  { market: 'A', code: '603290', name: '斯达半导', cat: 'A小盘' },
  { market: 'A', code: '002129', name: 'TCL中环', cat: 'A小盘' },
  { market: 'A', code: '601012', name: '隆基绿能', cat: 'A小盘' },
  { market: 'A', code: '600703', name: '三安光电', cat: 'A小盘' },
  // ETF（宽基 + 行业）
  { market: 'A', code: '510300', name: '沪深300ETF', cat: 'ETF' },
  { market: 'A', code: '510500', name: '中证500ETF', cat: 'ETF' },
  { market: 'A', code: '159915', name: '创业板ETF', cat: 'ETF' },
  { market: 'A', code: '588000', name: '科创50ETF', cat: 'ETF' },
  { market: 'A', code: '512880', name: '证券ETF', cat: 'ETF' },
  { market: 'A', code: '512170', name: '医疗ETF', cat: 'ETF' },
  { market: 'A', code: '512480', name: '半导体ETF', cat: 'ETF' },
  { market: 'A', code: '159928', name: '消费ETF', cat: 'ETF' },
  // 港股
  { market: 'HK', code: '00700', name: '腾讯控股', cat: '港股' },
  { market: 'HK', code: '09988', name: '阿里巴巴-W', cat: '港股' },
  { market: 'HK', code: '03690', name: '美团-W', cat: '港股' },
  { market: 'HK', code: '00388', name: '香港交易所', cat: '港股' },
  { market: 'HK', code: '02020', name: '安踏体育', cat: '港股' },
  { market: 'HK', code: '00941', name: '中国移动', cat: '港股' },
  { market: 'HK', code: '09999', name: '网易-S', cat: '港股' },
];

// ── 工具函数 ──────────────────────────────────────────────────────
const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

export async function fetchStrategies() {
  const r = await fetch(`${BASE}/api/strategy/list`);
  if (!r.ok) throw new Error('无法获取策略列表，后端是否启动？');
  return r.json();
}

export async function fetchFavorites() {
  const r = await fetch(`${BASE}/api/favorites`);
  if (!r.ok) throw new Error('无法获取收藏夹');
  const all = await r.json();
  return all
    .filter((x) => x.market !== 'FUND')
    .map((x) => ({ market: x.market, code: x.code, name: x.name, cat: '收藏夹' }));
}

export async function runBacktest(inst, win, strategyId) {
  const url =
    `${BASE}/api/strategy/backtest?market=${inst.market}&code=${inst.code}` +
    `&startDate=${win.start}&endDate=${win.end}&period=${PERIOD}&strategy=${strategyId}`;
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${body.slice(0, 120)}`);
  }
  return r.json();
}

// 并发池：对标的列表限流并发；每个标的内部按 区间×策略 顺序执行（首个调用预热 K 线缓存，避免并发重复打上游）
export async function mapPool(items, worker, concurrency) {
  const out = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/** 收藏夹(有效) + EXTRA 去重后的完整标的池。 */
export async function buildUniverse() {
  const favs = await fetchFavorites();
  const favKeys = new Set(favs.map((f) => `${f.market}:${f.code}`));
  const extra = EXTRA.filter((e) => !favKeys.has(`${e.market}:${e.code}`));
  return { favs, extra, universe: [...favs, ...extra] };
}

async function main() {
  console.log('▶ 连接后端', BASE);
  const strategies = await fetchStrategies();
  const { favs, extra, universe } = await buildUniverse();

  console.log(`▶ 标的 ${universe.length} 只（收藏夹 ${favs.length} + 新增 ${extra.length}），` +
    `区间 ${WINDOWS.length} 个，策略 ${strategies.length} 个`);
  console.log(`▶ 总回测调用 ${universe.length * WINDOWS.length * strategies.length} 次\n`);

  const rows = []; // { win, market, code, name, cat, strategy, priceChange, ret, mdd, sharpe, trades, ok, err }
  let done = 0;
  const totalInst = universe.length;

  await mapPool(
    universe,
    async (inst) => {
      for (const win of WINDOWS) {
        for (const s of strategies) {
          let rec = {
            winId: win.id, market: inst.market, code: inst.code, name: inst.name,
            cat: inst.cat, strategy: s.id, ok: false,
          };
          try {
            const res = await runBacktest(inst, win, s.id);
            rec = {
              ...rec, ok: true,
              priceChange: res.priceChangePercent,
              ret: res.returnPercent,
              mdd: res.maxDrawdown,
              sharpe: res.sharpeRatio,
              trades: res.tradeCount,
            };
          } catch (e) {
            rec.err = e.message;
          }
          rows.push(rec);
        }
      }
      done++;
      process.stdout.write(`\r  进度 ${done}/${totalInst} 标的  (${inst.name})            `);
    },
    CONCURRENCY,
  );
  process.stdout.write('\n');

  // 失败标的统计
  const failKeys = new Map();
  for (const r of rows) {
    if (!r.ok) {
      const k = `${r.market}:${r.code} ${r.name}`;
      failKeys.set(k, (failKeys.get(k) || '') || r.err);
    }
  }
  if (failKeys.size) {
    console.log(`\n⚠ ${failKeys.size} 只标的部分区间失败：`);
    for (const [k, e] of failKeys) console.log(`   ${k} → ${e}`);
  }

  writeReports(rows, strategies);
}

// ── 汇总统计 ──────────────────────────────────────────────────────
function summarize(rows, strategies) {
  // rows: 已筛过的子集（ok===true）
  return strategies.map((s) => {
    const r = rows.filter((x) => x.strategy === s.id && x.ok);
    const rets = r.map((x) => x.ret);
    const mdds = r.map((x) => x.mdd);
    const sharpes = r.map((x) => x.sharpe).filter((v) => v != null && !Number.isNaN(v));
    const winVsBH = r.filter((x) => x.ret > x.priceChange).length;
    const flat = r.filter((x) => Math.abs(x.ret) < 1e-9).length; // 空仓（收益≈0）
    return {
      id: s.id, name: s.name, n: r.length,
      retMed: median(rets), retMean: mean(rets),
      retP25: quantile(rets, 0.25), retP75: quantile(rets, 0.75),
      mddMed: median(mdds), sharpeMed: median(sharpes),
      winRate: r.length ? (winVsBH / r.length) * 100 : null,
      flatRate: r.length ? (flat / r.length) * 100 : null,
    };
  });
}

function summaryTable(rows, strategies) {
  // priceChange 对同一标的×区间在不同策略下重复，去重以算买入持有基准
  const seen = new Set();
  const uniqBH = [];
  for (const x of rows) {
    if (!x.ok) continue;
    const k = `${x.winId}|${x.market}:${x.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqBH.push(x.priceChange);
  }
  const lines = [];
  lines.push('| 策略 | 样本数 | 收益中位数(%) | 收益均值(%) | P25/P75(%) | 胜率(跑赢B&H) | 回撤中位数(%) | 夏普中位数 | 空仓率 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const x of summarize(rows, strategies)) {
    lines.push(
      `| ${x.name} | ${x.n} | ${fmt(x.retMed)} | ${fmt(x.retMean)} | ` +
      `${fmt(x.retP25)} / ${fmt(x.retP75)} | ${fmt(x.winRate, 0)}% | ` +
      `${fmt(x.mddMed)} | ${fmt(x.sharpeMed)} | ${fmt(x.flatRate, 0)}% |`,
    );
  }
  lines.push('');
  lines.push(`> 买入持有基准：区间涨跌中位数 **${fmt(median(uniqBH))}%**，均值 ${fmt(mean(uniqBH))}%（${uniqBH.length} 个标的×区间）`);
  return lines.join('\n');
}

function writeReports(rows, strategies) {
  const okRows = rows.filter((x) => x.ok);

  // CSV 明细
  const csvHead = 'window,market,code,name,cat,strategy,priceChange,return,maxDrawdown,sharpe,tradeCount,ok,err';
  const csvBody = rows.map((r) =>
    [r.winId, r.market, r.code, `"${r.name}"`, r.cat, r.strategy,
     fmt(r.priceChange), fmt(r.ret), fmt(r.mdd), fmt(r.sharpe), r.trades ?? '',
     r.ok, r.err ? `"${r.err.replace(/"/g, "'")}"` : ''].join(','),
  ).join('\n');
  writeFileSync('batch_backtest_raw.csv', csvHead + '\n' + csvBody + '\n');

  // Markdown 报告
  const md = [];
  md.push('# 策略回测结果汇总（广义样本 · 多区间）');
  md.push('');
  const nInst = new Set(okRows.map((r) => `${r.market}:${r.code}`)).size;
  md.push(`- K线周期：日线`);
  md.push(`- 标的范围：收藏夹 + 无偏抽样篮子，共 **${nInst}** 只有效标的（沪深300/中证500-1000/科创/宽基+行业ETF/港股，跨板块）`);
  md.push(`- 时间区间：${WINDOWS.length} 段（覆盖不同 regime），各段预留 ~70 交易日预热`);
  WINDOWS.forEach((w) => md.push(`  - **${w.id}**：${w.label}`));
  md.push(`- 策略：${strategies.map((s) => `\`${s.id}\` ${s.name}`).join(' ｜ ')}`);
  md.push('');
  md.push('## 方法论说明');
  md.push('- **为何看分布而非均值**：少量翻倍股会绑架均值（旧 14 只报告即如此），故主看 **收益中位数、胜率、P25/P75 分位**。');
  md.push('- **胜率(跑赢B&H)**：该标的×区间策略收益 > 同期买入持有(区间涨跌)的占比——衡量策略相对基准的相对价值。');
  md.push('- **空仓率**：策略收益≈0（regime 过滤下全程未入场）的占比，体现弱势/震荡市的回撤保护倾向。');
  md.push('- **夏普口径**：净值逐日收益率的年化夏普（×√252），与单标的回测接口一致。');
  md.push('');

  // 总体
  md.push('## 总体（全部标的 × 全部区间）');
  md.push('');
  md.push(summaryTable(okRows, strategies));
  md.push('');

  // 按区间
  md.push('## 按时间区间');
  for (const w of WINDOWS) {
    md.push('');
    md.push(`### ${w.id} ｜ ${w.label}`);
    md.push('');
    md.push(summaryTable(okRows.filter((r) => r.winId === w.id), strategies));
  }
  md.push('');

  // 按分类（总体合并区间）
  md.push('## 按标的分类（合并全部区间）');
  const cats = [...new Set(okRows.map((r) => r.cat))];
  for (const c of cats) {
    md.push('');
    md.push(`### ${c}`);
    md.push('');
    md.push(summaryTable(okRows.filter((r) => r.cat === c), strategies));
  }
  md.push('');
  md.push('---');
  md.push('明细见 `batch_backtest_raw.csv`（每行：区间×标的×策略）。');
  md.push('');

  writeFileSync('all_strategy_result_broad.md', md.join('\n'));
  console.log('\n✓ 已生成 all_strategy_result_broad.md 与 batch_backtest_raw.csv');
}

// 仅在直接执行时运行；被 import 时只复用导出的工具函数
if (process.argv[1] && process.argv[1].endsWith('batch-backtest.mjs')) {
  main().catch((e) => {
    console.error('\n✗ 运行失败：', e.message);
    process.exit(1);
  });
}
