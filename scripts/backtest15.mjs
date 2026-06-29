#!/usr/bin/env node
/**
 * 15min 策略回测专用测试集 + 对比工具。
 *
 * 为什么单独一套（不复用 batch-backtest.mjs）：15min 分钟线上游最多 ~800 根 ≈ 最近
 * 50 个交易日且不可回溯（见 AGENTS.md KlineService），无法做日线那种「多年多 regime」
 * 样本外验证。本脚本因此用**固定的一篮子分层 A 股/ETF**（覆盖大盘/中盘/小盘科创/宽基与
 * 行业 ETF，各类「趋势」形态都有）× 数据窗口内的「全段 / 震荡前半段 / 拉升后半段」三个
 * 区间，跑分布口径对比，用来评估 15min 策略的「下跌保护 + 趋势参与」是否平衡。
 *
 * ⚠️ 数据窗口随「今天」滑动：本测试集的日期区间以截至 2026-06-22 的 ~50 交易日窗口设定，
 *    若隔较长时间重跑，需把 WINDOWS 的日期顺移到当前可用窗口内（脚本对取不到数据的
 *    标的×区间会跳过并计入失败，不影响其余统计）。
 *
 * 依赖：后端需在 http://localhost:3100 运行（pnpm start:dev）。
 * 用法：
 *   node scripts/backtest15.mjs                  # 默认对比当前已注册的全部策略中的 15min 候选
 *   node scripts/backtest15.mjs pullback15        # 只跑某几个策略 id
 *   node scripts/backtest15.mjs pullback15 trend5 # A/B 对比
 * 产物（仅当传 --report 时写文件）：
 *   node scripts/backtest15.mjs pullback15 --report
 *   - all_strategy_result_15min.md   汇总报告（总体 + 按区间 + 按分类）
 *   - batch_backtest_15min_raw.csv   每行明细（区间×标的×策略）
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { authHeaders } from './auth.mjs';

// 所有分析结果（报告 md + 明细 csv）统一输出到 dist/
const OUT_DIR = 'dist';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const PERIOD = '15min';
const CONCURRENCY = 4;

// ── 时间区间（数据窗口内）──────────────────────────────────────────
// 15min 数据约覆盖 2026-04-08 ~ 2026-06-22（~50 交易日）。MA60 需 60 根预热，故
// 各区间的有效开仓起点会比 start 晚约 4 个交易日，这对所有策略一致，不影响对比公平性。
export const WINDOWS = [
  { id: 'W_full', label: '2026-04-09 ~ 2026-06-22（全段）', start: '2026-04-09', end: '2026-06-22' },
  { id: 'W_chop', label: '2026-04-09 ~ 2026-05-19（震荡/回撤前半段）', start: '2026-04-09', end: '2026-05-19' },
  { id: 'W_rally', label: '2026-05-20 ~ 2026-06-22（拉升后半段）', start: '2026-05-20', end: '2026-06-22' },
];

// ── 固定测试集（记录在案，供后续迭代对比复用，不要随意改动）──────────
// 选样原则：A 股跨市值/板块 + 宽基与行业 ETF，覆盖「强趋势单边」「震荡」「冲高回落」
// 「阴跌」等不同趋势形态；含本次问题标的 600498 烽火通信。
// 不含港股：港股 15min 走 Yahoo，可取窗口更短（~1 个月）且不稳定，混入会污染跨标的分布对比。
export const TEST_SET = [
  // 本次问题标的（强趋势 + 末段加速大涨）
  { market: 'A', code: '600498', name: '烽火通信', cat: 'A中盘' },
  // A股大盘（沪深300，跨板块）
  { market: 'A', code: '600519', name: '贵州茅台', cat: 'A大盘' },
  { market: 'A', code: '600036', name: '招商银行', cat: 'A大盘' },
  { market: 'A', code: '600900', name: '长江电力', cat: 'A大盘' },
  { market: 'A', code: '600276', name: '恒瑞医药', cat: 'A大盘' },
  { market: 'A', code: '000858', name: '五粮液', cat: 'A大盘' },
  { market: 'A', code: '000333', name: '美的集团', cat: 'A大盘' },
  { market: 'A', code: '300750', name: '宁德时代', cat: 'A大盘' },
  { market: 'A', code: '002594', name: '比亚迪', cat: 'A大盘' },
  { market: 'A', code: '600030', name: '中信证券', cat: 'A大盘' },
  { market: 'A', code: '601899', name: '紫金矿业', cat: 'A大盘' },
  { market: 'A', code: '002415', name: '海康威视', cat: 'A大盘' },
  // A股中盘（中证500 量级，跨板块）
  { market: 'A', code: '002241', name: '歌尔股份', cat: 'A中盘' },
  { market: 'A', code: '002714', name: '牧原股份', cat: 'A中盘' },
  { market: 'A', code: '600438', name: '通威股份', cat: 'A中盘' },
  { market: 'A', code: '601633', name: '长城汽车', cat: 'A中盘' },
  { market: 'A', code: '603259', name: '药明康德', cat: 'A中盘' },
  { market: 'A', code: '002230', name: '科大讯飞', cat: 'A中盘' },
  { market: 'A', code: '000725', name: '京东方A', cat: 'A中盘' },
  // A股小盘 / 科创（中证1000 + 科创板，偏科技成长，趋势更陡）
  { market: 'A', code: '300274', name: '阳光电源', cat: 'A小盘' },
  { market: 'A', code: '688981', name: '中芯国际', cat: 'A小盘' },
  { market: 'A', code: '688111', name: '金山办公', cat: 'A小盘' },
  { market: 'A', code: '688012', name: '中微公司', cat: 'A小盘' },
  { market: 'A', code: '002129', name: 'TCL中环', cat: 'A小盘' },
  { market: 'A', code: '601012', name: '隆基绿能', cat: 'A小盘' },
  { market: 'A', code: '600703', name: '三安光电', cat: 'A小盘' },
  // ETF（宽基 + 行业）
  { market: 'A', code: '510300', name: '沪深300ETF', cat: 'ETF' },
  { market: 'A', code: '510500', name: '中证500ETF', cat: 'ETF' },
  { market: 'A', code: '159915', name: '创业板ETF', cat: 'ETF' },
  { market: 'A', code: '588000', name: '科创50ETF', cat: 'ETF' },
  { market: 'A', code: '512880', name: '证券ETF', cat: 'ETF' },
  { market: 'A', code: '512480', name: '半导体ETF', cat: 'ETF' },
  { market: 'A', code: '159928', name: '消费ETF', cat: 'ETF' },
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

async function fetchStrategies() {
  const r = await fetch(`${BASE}/api/strategy/list`, { headers: await authHeaders(BASE) });
  if (!r.ok) throw new Error('无法获取策略列表，后端是否启动？');
  return r.json();
}

async function runBacktest(inst, win, strategyId) {
  const url =
    `${BASE}/api/strategy/backtest?market=${inst.market}&code=${inst.code}` +
    `&startDate=${win.start}&endDate=${win.end}&period=${PERIOD}&strategy=${strategyId}`;
  const r = await fetch(url, { headers: await authHeaders(BASE) });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${body.slice(0, 120)}`);
  }
  return r.json();
}

async function mapPool(items, worker, concurrency) {
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

// ── 统计 ──────────────────────────────────────────────────────────
function summarize(rows, ids) {
  return ids.map((id) => {
    const r = rows.filter((x) => x.strategy === id && x.ok);
    const rets = r.map((x) => x.ret);
    const mdds = r.map((x) => x.mdd);
    const sharpes = r.map((x) => x.sharpe).filter((v) => v != null && !Number.isNaN(v));
    const winVsBH = r.filter((x) => x.ret > x.priceChange).length;
    const flat = r.filter((x) => Math.abs(x.ret) < 1e-9).length;
    return {
      id, n: r.length,
      retMed: median(rets), retMean: mean(rets),
      retP25: quantile(rets, 0.25), retP75: quantile(rets, 0.75),
      mddMed: median(mdds), sharpeMed: median(sharpes),
      winRate: r.length ? (winVsBH / r.length) * 100 : null,
      flatRate: r.length ? (flat / r.length) * 100 : null,
    };
  });
}

function summaryTable(rows, ids) {
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
  for (const x of summarize(rows, ids)) {
    lines.push(
      `| ${x.id} | ${x.n} | ${fmt(x.retMed)} | ${fmt(x.retMean)} | ` +
      `${fmt(x.retP25)} / ${fmt(x.retP75)} | ${fmt(x.winRate, 0)}% | ` +
      `${fmt(x.mddMed)} | ${fmt(x.sharpeMed)} | ${fmt(x.flatRate, 0)}% |`,
    );
  }
  lines.push('');
  lines.push(`> 买入持有基准：区间涨跌中位数 **${fmt(median(uniqBH))}%**，均值 ${fmt(mean(uniqBH))}%（${uniqBH.length} 个标的×区间）`);
  return lines.join('\n');
}

function printConsole(rows, ids) {
  const pad = (s, w) => String(s).padEnd(w);
  const padL = (s, w) => String(s).padStart(w);
  const head = (title) => {
    console.log(`\n## ${title}`);
    console.log(pad('策略', 12) + padL('收益中位', 9) + padL('收益均值', 9) +
      padL('胜率%', 7) + padL('回撤中位', 9) + padL('夏普中位', 9) + padL('空仓%', 7));
  };
  const block = (subset, title) => {
    head(title);
    for (const x of summarize(subset, ids)) {
      console.log(pad(x.id, 12) + padL(fmt(x.retMed), 9) + padL(fmt(x.retMean), 9) +
        padL(fmt(x.winRate, 0), 7) + padL(fmt(x.mddMed), 9) + padL(fmt(x.sharpeMed), 9) +
        padL(fmt(x.flatRate, 0), 7));
    }
  };
  block(rows.filter((r) => r.ok), '总体（全部区间）');
  for (const w of WINDOWS) block(rows.filter((r) => r.ok && r.winId === w.id), `${w.id} ｜ ${w.label}`);
}

function writeReports(rows, ids) {
  mkdirSync(OUT_DIR, { recursive: true });
  const okRows = rows.filter((x) => x.ok);
  const csvHead = '区间,市场,代码,名称,分类,策略,区间涨跌%,回测收益%,最大回撤%,夏普,交易次数,成功,错误';
  const csvBody = rows.map((r) =>
    [r.winId, r.market, r.code, `"${r.name}"`, r.cat, r.strategy,
     fmt(r.priceChange), fmt(r.ret), fmt(r.mdd), fmt(r.sharpe), r.trades ?? '',
     r.ok, r.err ? `"${r.err.replace(/"/g, "'")}"` : ''].join(','),
  ).join('\n');
  writeFileSync(`${OUT_DIR}/batch_backtest_15min_raw.csv`, csvHead + '\n' + csvBody + '\n');

  const md = [];
  md.push('# 15min 策略回测结果汇总（固定测试集 · 多区间）');
  md.push('');
  const nInst = new Set(okRows.map((r) => `${r.market}:${r.code}`)).size;
  md.push(`- K线周期：15min`);
  md.push(`- 测试集：固定 ${TEST_SET.length} 只 A 股/ETF（见 \`scripts/backtest15.mjs\` 的 \`TEST_SET\`），有效 **${nInst}** 只`);
  md.push(`- 时间区间（数据窗口内，随「今天」滑动）：`);
  WINDOWS.forEach((w) => md.push(`  - **${w.id}**：${w.label}`));
  md.push(`- 对比策略：${ids.map((id) => `\`${id}\``).join(' ｜ ')}`);
  md.push('');
  md.push('## 方法论');
  md.push('- 看**分布**而非均值：主看收益中位数、胜率(跑赢买入持有)、P25/P75、回撤中位数。');
  md.push('- **W_chop** 检验震荡/回撤段的下跌保护；**W_rally** 检验单边拉升的趋势参与；**W_full** 看综合。');
  md.push('- 空仓率：策略全程未入场（收益≈0）的占比。');
  md.push('');
  md.push('## 总体（全部标的 × 全部区间）');
  md.push('');
  md.push(summaryTable(okRows, ids));
  md.push('');
  md.push('## 按时间区间');
  for (const w of WINDOWS) {
    md.push('');
    md.push(`### ${w.id} ｜ ${w.label}`);
    md.push('');
    md.push(summaryTable(okRows.filter((r) => r.winId === w.id), ids));
  }
  md.push('');
  md.push('## 按标的分类（合并全部区间）');
  for (const c of [...new Set(okRows.map((r) => r.cat))]) {
    md.push('');
    md.push(`### ${c}`);
    md.push('');
    md.push(summaryTable(okRows.filter((r) => r.cat === c), ids));
  }
  md.push('');
  md.push('---');
  md.push('明细见 `batch_backtest_15min_raw.csv`（每行：区间×标的×策略）。');
  md.push('');
  writeFileSync(`${OUT_DIR}/all_strategy_result_15min.md`, md.join('\n'));
  console.log(`\n✓ 已生成 ${OUT_DIR}/all_strategy_result_15min.md 与 ${OUT_DIR}/batch_backtest_15min_raw.csv`);
}

async function main() {
  const args = process.argv.slice(2);
  const wantReport = args.includes('--report');
  const idArgs = args.filter((a) => !a.startsWith('--'));
  const registered = await fetchStrategies();
  const ids = idArgs.length ? idArgs : registered.map((s) => s.id).filter((id) => id === 'pullback15');
  if (!ids.length) {
    console.error('未指定策略 id，且默认候选 pullback15 不在已注册列表中。');
    process.exit(1);
  }
  console.log(`▶ 15min 测试集：标的 ${TEST_SET.length} × 区间 ${WINDOWS.length} × 策略 ${ids.length} = ${TEST_SET.length * WINDOWS.length * ids.length} 次`);
  console.log(`▶ 策略：${ids.join(' vs ')}`);

  const rows = [];
  let done = 0;
  await mapPool(TEST_SET, async (inst) => {
    for (const win of WINDOWS) {
      for (const id of ids) {
        let rec = { winId: win.id, market: inst.market, code: inst.code, name: inst.name, cat: inst.cat, strategy: id, ok: false };
        try {
          const res = await runBacktest(inst, win, id);
          rec = { ...rec, ok: true, priceChange: res.priceChangePercent, ret: res.returnPercent, mdd: res.maxDrawdown, sharpe: res.sharpeRatio, trades: res.tradeCount };
        } catch (e) {
          rec.err = e.message;
        }
        rows.push(rec);
      }
    }
    process.stdout.write(`\r  进度 ${++done}/${TEST_SET.length} (${inst.name})            `);
  }, CONCURRENCY);
  process.stdout.write('\n');

  const fails = rows.filter((r) => !r.ok);
  if (fails.length) {
    const byInst = new Map();
    for (const r of fails) byInst.set(`${r.market}:${r.code} ${r.name}`, r.err);
    console.log(`⚠ ${byInst.size} 只标的部分区间失败：`);
    for (const [k, e] of byInst) console.log(`   ${k} → ${e}`);
  }

  printConsole(rows, ids);
  if (wantReport) writeReports(rows, ids);
}

main().catch((e) => {
  console.error('\n✗ 失败：', e.message);
  process.exit(1);
});
