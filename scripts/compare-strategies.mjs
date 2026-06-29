#!/usr/bin/env node
/**
 * 策略快速对比（迭代用）：对同一标的池 × 同一组区间跑指定策略，
 * 打印紧凑的「按区间 + 总体」分布对比，便于快速 A/B 调参。
 *
 * 用法：node scripts/compare-strategies.mjs trend3 trend5 trend6
 *       （不带参数则默认对比 trend5 trend6）
 * 依赖：后端需在 http://localhost:3100 运行。
 */
import { WINDOWS, buildUniverse, runBacktest, mapPool } from './batch-backtest.mjs';

const CONCURRENCY = 4;
const args = process.argv.slice(2);
// 过滤标的子集：--only=etf 仅场内 ETF（A 市场代码 1/5 开头）；--only=stock 仅非 ETF
const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const nonFlag = args.filter((a) => !a.startsWith('--'));
const ids = nonFlag.length ? nonFlag : ['trend5', 'trend6'];
const isEtf = (inst) => inst.market === 'A' && /^[15]/.test(inst.code);
const instFilter = (inst) =>
  onlyArg === 'etf' ? isEtf(inst) : onlyArg === 'stock' ? !isEtf(inst) : true;

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f = (x, d = 2) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

function statBlock(rows) {
  const rets = rows.map((r) => r.ret);
  const win = rows.filter((r) => r.ret > r.pc).length;
  const flat = rows.filter((r) => Math.abs(r.ret) < 1e-9).length;
  const dd = rows.map((r) => r.mdd);
  const sh = rows.map((r) => r.sharpe).filter((v) => v != null && !Number.isNaN(v));
  return {
    n: rows.length,
    med: median(rets), mean: mean(rets),
    win: rows.length ? (win / rows.length) * 100 : null,
    dd: median(dd), sh: median(sh),
    flat: rows.length ? (flat / rows.length) * 100 : null,
  };
}

function printTable(title, perStrategyRows) {
  console.log(`\n## ${title}`);
  console.log(
    pad('策略', 10) + padL('收益中位', 9) + padL('收益均值', 9) +
    padL('胜率%', 8) + padL('回撤中位', 9) + padL('夏普中位', 9) + padL('空仓%', 8),
  );
  for (const id of ids) {
    const s = statBlock(perStrategyRows[id]);
    console.log(
      pad(id, 10) + padL(f(s.med), 9) + padL(f(s.mean), 9) +
      padL(f(s.win, 0), 8) + padL(f(s.dd), 9) + padL(f(s.sh), 9) + padL(f(s.flat, 0), 8),
    );
  }
}

async function main() {
  const built = await buildUniverse();
  const universe = built.universe.filter(instFilter);
  console.log(`▶ 对比策略: ${ids.join(' vs ')}${onlyArg ? `  [子集: ${onlyArg}]` : ''}`);
  console.log(`▶ 标的 ${universe.length} × 区间 ${WINDOWS.length} × 策略 ${ids.length} = ${universe.length * WINDOWS.length * ids.length} 次`);

  const all = []; // { winId, key, ret, pc, mdd, sharpe }
  let done = 0;
  await mapPool(universe, async (inst) => {
    for (const w of WINDOWS) {
      for (const id of ids) {
        try {
          const res = await runBacktest(inst, w, id);
          all.push({
            strategy: id, winId: w.id,
            ret: res.returnPercent, pc: res.priceChangePercent,
            mdd: res.maxDrawdown, sharpe: res.sharpeRatio,
          });
        } catch (e) {
          all.push({ strategy: id, winId: w.id, ret: 0, pc: 0, mdd: 0, sharpe: null, err: e.message });
        }
      }
    }
    process.stdout.write(`\r  进度 ${++done}/${universe.length}   `);
  }, CONCURRENCY);
  process.stdout.write('\n');

  const errs = all.filter((r) => r.err);
  if (errs.length) console.log(`⚠ ${errs.length} 次失败（示例: ${errs[0].err}）`);

  // 总体
  const byStrat = {};
  for (const id of ids) byStrat[id] = all.filter((r) => r.strategy === id && !r.err);
  printTable('总体（全部区间）', byStrat);

  // 按区间
  for (const w of WINDOWS) {
    const per = {};
    for (const id of ids) per[id] = all.filter((r) => r.strategy === id && r.winId === w.id && !r.err);
    printTable(`${w.id} ｜ ${w.label}`, per);
  }
}

main().catch((e) => {
  console.error('\n✗ 失败：', e.message);
  process.exit(1);
});
