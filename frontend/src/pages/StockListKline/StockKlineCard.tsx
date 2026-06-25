import { useEffect, useRef, useState, useMemo, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Spin, Tag } from 'antd';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LogicalRange, Time } from 'lightweight-charts';
import { klineApi } from '../../api/stock';
import type { DarkTradeData, DarkTradeSnapshot, KlineBar, KlinePeriod } from '../../types';
import styles from './StockListKline.module.css';

export type OverlayMode = 'ma' | 'boll';

export interface CardHandle {
  setRange: (range: LogicalRange) => void;
}

interface Props {
  code: string;
  market: 'A' | 'HK';
  name: string;
  period: KlinePeriod;
  overlay: OverlayMode;
  showVolume: boolean;
  showMacd: boolean;
  showRsi: boolean;
  showDarkTrade?: boolean;
  darkTradeData?: DarkTradeData | null;
  darkTradeSnapshots?: DarkTradeSnapshot[];
  onRangeChange?: (range: LogicalRange) => void;
}

const MAIN_HEIGHT = 200;
// 分时图全天时间槽总数：上午 121(09:30–11:30) + 下午 121(13:00–15:00)，午休不画
const TIMESHARE_SLOTS = 242;
const VOLUME_HEIGHT = 50;
const MACD_HEIGHT = 70;
const RSI_HEIGHT = 50;
const DT_HEIGHT = 60;
// 明盘资金：正值红色 / 负值绿色
const LIGHT_POS_COLOR = '#ef5350';
const LIGHT_NEG_COLOR = '#26a69a';
// 暗盘资金：正值浅红 / 负值浅绿
const DARK_POS_COLOR = '#ffa39e';
const DARK_NEG_COLOR = '#87e8de';

const CHART_BASE = {
  layout: {
    background: { type: ColorType.Solid, color: '#ffffff' as const },
    textColor: '#333',
    attributionLogo: false,
  },
  grid: {
    vertLines: { color: '#f0f0f0' },
    horzLines: { color: '#f0f0f0' },
  },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#e0e0e0' },
  timeScale: { borderColor: '#e0e0e0', fixRightEdge: true },
};

function toChartTime(t: string): Time {
  if (!t.includes(' ')) return t as Time;
  const [date, time] = t.split(' ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return (Date.UTC(y, mo - 1, d, h, mi) / 1000) as Time;
}

function formatCapital(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
}

// 生成分时图全天数据：实际 bar 填收盘价，其余时间槽（含午休）填 WhitespaceData 占位
// 这样 fitContent() 能自然铺满 09:30–15:00，午休也按比例留空
function buildTimeshareData(
  bars: KlineBar[],
  lastDate: string,
): ({ time: Time; value: number } | { time: Time })[] {
  const barMap = new Map<string, number>();
  bars.forEach((b) => barMap.set(b.time, b.close));
  const result: ({ time: Time; value: number } | { time: Time })[] = [];
  const addRange = (fromMin: number, toMin: number) => {
    for (let m = fromMin; m <= toMin; m++) {
      const t = `${lastDate} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const v = barMap.get(t);
      result.push(v !== undefined ? { time: toChartTime(t), value: v } : { time: toChartTime(t) });
    }
  };
  addRange(9 * 60 + 30, 11 * 60 + 30); // 09:30–11:30 上午
  addRange(13 * 60, 15 * 60);          // 13:00–15:00 下午
  return result;
}

function isInTradingHours(market: 'A' | 'HK'): boolean {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
  const h = utc8.getUTCHours();
  const m = utc8.getUTCMinutes();
  const day = utc8.getUTCDay();
  if (day === 0 || day === 6) return false;
  const t = h * 60 + m;
  if (market === 'A') return (t >= 570 && t < 690) || (t >= 780 && t < 900);
  return (t >= 570 && t < 720) || (t >= 780 && t < 960);
}

const StockKlineCard = forwardRef<CardHandle, Props>(function StockKlineCard(
  { code, market, name, period, overlay, showVolume, showMacd, showRsi, showDarkTrade, darkTradeData, darkTradeSnapshots, onRangeChange },
  ref,
) {
  const [loading, setLoading] = useState(true);
  const [bars, setBars] = useState<KlineBar[]>([]);
  const hasDarkData = darkTradeData != null;
  const darkCapital = darkTradeData?.darkCapital ?? null;
  const lightCapital = darkTradeData?.lightCapital ?? null;

  const todayChange = useMemo(() => {
    if (bars.length === 0) return null;
    if (period === 'daily' || period === 'weekly') {
      return bars[bars.length - 1].changePercent;
    }
    // 分时/分钟线：取最后一个交易日的所有 bar，算当日开盘→收盘涨幅
    const lastDate = bars[bars.length - 1].time.slice(0, 10);
    const dayBars = bars.filter((b) => b.time.startsWith(lastDate));
    const open = dayBars[0].open;
    const close = dayBars[dayBars.length - 1].close;
    if (!open) return null;
    return ((close - open) / open) * 100;
  }, [bars, period]);

  const currentPrice = bars.length > 0 ? bars[bars.length - 1].close : null;

  const mainRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const darkTradeRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const darkTradeChartRef = useRef<IChartApi | null>(null);
  const dtSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const darkTradeSnapshotsRef = useRef<DarkTradeSnapshot[]>([]);
  const syncingRef = useRef(false);
  const isLockedRef = useRef(false);
  const onRangeChangeRef = useRef(onRangeChange);
  useEffect(() => { onRangeChangeRef.current = onRangeChange; });
  const periodRef = useRef(period);
  useEffect(() => { periodRef.current = period; });
  const isRebuildingRef = useRef(false);

  const populateDarkTradeData = useCallback(() => {
    const chart = darkTradeChartRef.current;
    if (!chart) return;
    dtSeriesRef.current.forEach((s) => chart.removeSeries(s));
    dtSeriesRef.current = [];
    const seen = new Set<string>();
    const snaps = darkTradeSnapshotsRef.current.filter((s) => {
      if (seen.has(s.time)) return false;
      seen.add(s.time);
      return true;
    });
    if (snaps.length === 0) return;

    const addLine = (color: string, data: { time: Time; value: number }[], withZeroLine = false) => {
      if (data.length === 0) return;
      const series = chart.addSeries(LineSeries, { color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      series.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      series.setData(data);
      if (withZeroLine) series.createPriceLine({ price: 0, color: '#bbb', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      dtSeriesRef.current.push(series);
    };

    // 明盘：正值红色，负值绿色
    addLine(LIGHT_POS_COLOR, snaps.filter((s) => (s.lightCapital ?? 0) >= 0).map((s) => ({ time: toChartTime(s.time), value: s.lightCapital ?? 0 })), true);
    addLine(LIGHT_NEG_COLOR, snaps.filter((s) => (s.lightCapital ?? 0) < 0).map((s) => ({ time: toChartTime(s.time), value: s.lightCapital ?? 0 })));
    // 暗盘：正值浅红，负值浅绿
    addLine(DARK_POS_COLOR, snaps.filter((s) => (s.darkCapital ?? 0) >= 0).map((s) => ({ time: toChartTime(s.time), value: s.darkCapital ?? 0 })));
    addLine(DARK_NEG_COLOR, snaps.filter((s) => (s.darkCapital ?? 0) < 0).map((s) => ({ time: toChartTime(s.time), value: s.darkCapital ?? 0 })));

    chart.timeScale().fitContent();
  }, []);

  useImperativeHandle(ref, () => ({
    setRange: (range: LogicalRange) => {
      isLockedRef.current = true;
      mainChartRef.current?.timeScale().setVisibleLogicalRange(range);
      requestAnimationFrame(() => { isLockedRef.current = false; });
    },
  }));

  // Effect 1: 拉取 K 线数据（period/code/market 变化时重新拉取）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBars([]);
    klineApi
      .get(market, code, period)
      .then((res) => { if (!cancelled) setBars(res.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, market, period]);

  // Effect 3: 交易时段内 30 秒轮询刷新（只在数据实际变化时触发重绘）
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isInTradingHours(market)) return;
      klineApi
        .get(market, code, period)
        .then((res) => {
          setBars((prev) => {
            const next = res.data;
            const prevLast = prev[prev.length - 1];
            const nextLast = next[next.length - 1];
            if (
              prev.length === next.length &&
              prevLast?.time === nextLast?.time &&
              prevLast?.close === nextLast?.close
            ) {
              return prev;
            }
            return next;
          });
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [code, market, period]);

  // Effect 2: 渲染图表（bars/overlay/副图开关变化时重绘，不重新拉取数据）
  useEffect(() => {
    if (!mainRef.current || bars.length === 0) return;

    isRebuildingRef.current = true;
    const currentPeriod = periodRef.current;
    const isTimeshare = currentPeriod === 'timeshare';
    const timeVisible = currentPeriod !== 'daily' && currentPeriod !== 'weekly';
    const interactionOpts = isTimeshare ? { handleScroll: false, handleScale: false } : {};

    const mainChart = createChart(mainRef.current, {
      ...CHART_BASE,
      ...interactionOpts,
      autoSize: true,
      height: MAIN_HEIGHT,
      timeScale: { ...CHART_BASE.timeScale, timeVisible, fixRightEdge: !isTimeshare },
    });
    mainChartRef.current = mainChart;

    let volumeChart: IChartApi | null = null;
    let macdChart: IChartApi | null = null;
    let rsiChart: IChartApi | null = null;
    let darkTradeChart: IChartApi | null = null;

    if (showVolume && volumeRef.current) {
      volumeChart = createChart(volumeRef.current, {
        ...CHART_BASE,
        ...interactionOpts,
        autoSize: true,
        height: VOLUME_HEIGHT,
        timeScale: { ...CHART_BASE.timeScale, visible: false, fixRightEdge: !isTimeshare },
      });
    }
    if (showMacd && macdRef.current) {
      macdChart = createChart(macdRef.current, {
        ...CHART_BASE,
        ...interactionOpts,
        autoSize: true,
        height: MACD_HEIGHT,
        timeScale: { ...CHART_BASE.timeScale, visible: false, fixRightEdge: !isTimeshare },
      });
    }
    if (showRsi && rsiRef.current) {
      rsiChart = createChart(rsiRef.current, {
        ...CHART_BASE,
        ...interactionOpts,
        autoSize: true,
        height: RSI_HEIGHT,
        timeScale: { ...CHART_BASE.timeScale, visible: false, fixRightEdge: !isTimeshare },
      });
    }

    if (showDarkTrade && darkTradeRef.current) {
      darkTradeChart = createChart(darkTradeRef.current, {
        ...CHART_BASE,
        autoSize: true,
        height: DT_HEIGHT,
        handleScroll: false,
        handleScale: false,
        timeScale: { ...CHART_BASE.timeScale, visible: false },
        localization: {
          priceFormatter: (v: number) => {
            const abs = Math.abs(v);
            if (abs >= 1e7) return (v / 1e8).toFixed(2) + '亿';
            if (abs >= 1e4) return (v / 1e4).toFixed(0) + '万';
            return v.toFixed(0);
          },
        },
      });
      darkTradeChartRef.current = darkTradeChart;
      dtSeriesRef.current = [];
      populateDarkTradeData();
    }

    const subCharts = [volumeChart, macdChart, rsiChart].filter(Boolean) as IChartApi[];

    // 主图变化时同步所有副图，并向上通知跨卡片联动
    mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncingRef.current || !range) return;
      syncingRef.current = true;
      subCharts.forEach((c) => c.timeScale().setVisibleLogicalRange(range));
      syncingRef.current = false;
      if (!isLockedRef.current && !isRebuildingRef.current) onRangeChangeRef.current?.(range);
    });

    // 任意副图变化时同步主图和其他副图
    subCharts.forEach((subChart) => {
      subChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        mainChart.timeScale().setVisibleLogicalRange(range);
        subCharts.filter((c) => c !== subChart).forEach((c) => c.timeScale().setVisibleLogicalRange(range));
        syncingRef.current = false;
        if (!isLockedRef.current && !isRebuildingRef.current) onRangeChangeRef.current?.(range);
      });
    });

    const seen = new Set<number>();
    const dedupedBars = bars.filter((b) => {
      const t = toChartTime(b.time) as number;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
    const times = dedupedBars.map((b) => toChartTime(b.time));

    // ── 主图系列 ──────────────────────────────────────────────────
    if (currentPeriod === 'timeshare') {
      const areaSeries = mainChart.addSeries(AreaSeries, {
        topColor: 'rgba(22, 119, 255, 0.28)',
        bottomColor: 'rgba(22, 119, 255, 0)',
        lineColor: '#1677ff',
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      areaSeries.setData(buildTimeshareData(dedupedBars, dedupedBars[dedupedBars.length - 1].time.slice(0, 10)) as any);
      areaSeries.createPriceLine({ price: dedupedBars[0].open, color: 'rgba(150,150,150,0.45)', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false });
    } else {
      const candleSeries = mainChart.addSeries(CandlestickSeries, {
        upColor: '#ef5350',
        downColor: '#26a69a',
        borderUpColor: '#ef5350',
        borderDownColor: '#26a69a',
        wickUpColor: '#ef5350',
        wickDownColor: '#26a69a',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      candleSeries.setData(
        dedupedBars.map((b, i) => ({ time: times[i], open: b.open, high: b.high, low: b.low, close: b.close })),
      );

      if (overlay === 'ma') {
        const ma5 = mainChart.addSeries(LineSeries, { color: '#FFAB00', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
        ma5.setData(dedupedBars.filter((b) => b.ma.ma5 != null).map((b) => ({ time: toChartTime(b.time), value: b.ma.ma5! })));

        const ma10 = mainChart.addSeries(LineSeries, { color: '#FF6B9D', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
        ma10.setData(dedupedBars.filter((b) => b.ma.ma10 != null).map((b) => ({ time: toChartTime(b.time), value: b.ma.ma10! })));

        const ma20 = mainChart.addSeries(LineSeries, { color: '#1677ff', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
        ma20.setData(dedupedBars.filter((b) => b.ma.ma20 != null).map((b) => ({ time: toChartTime(b.time), value: b.ma.ma20! })));
      } else {
        const bollUpper = mainChart.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
        bollUpper.setData(dedupedBars.filter((b) => b.boll.upper != null).map((b) => ({ time: toChartTime(b.time), value: b.boll.upper! })));

        const bollMid = mainChart.addSeries(LineSeries, { color: '#1677ff', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
        bollMid.setData(dedupedBars.filter((b) => b.boll.mid != null).map((b) => ({ time: toChartTime(b.time), value: b.boll.mid! })));

        const bollLower = mainChart.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
        bollLower.setData(dedupedBars.filter((b) => b.boll.lower != null).map((b) => ({ time: toChartTime(b.time), value: b.boll.lower! })));
      }
    }

    // ── 成交量副图 ────────────────────────────────────────────────
    if (volumeChart) {
      const volSeries = volumeChart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
      volSeries.setData(
        dedupedBars.map((b, i) => ({ time: times[i], value: b.volume, color: b.close >= b.open ? '#ef5350' : '#26a69a' })),
      );
    }

    // ── MACD 副图 ─────────────────────────────────────────────────
    if (macdChart) {
      const macdHist = macdChart.addSeries(HistogramSeries, {
        lastValueVisible: false,
        priceLineVisible: false,
      });
      macdHist.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0.2 } });
      macdHist.setData(
        dedupedBars.map((b, i) => ({ time: times[i], value: b.macd.bar, color: b.macd.bar >= 0 ? '#ef5350' : '#26a69a' })),
      );

      const difSeries = macdChart.addSeries(LineSeries, { color: '#1677ff', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      difSeries.setData(dedupedBars.map((b, i) => ({ time: times[i], value: b.macd.dif })));

      const deaSeries = macdChart.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      deaSeries.setData(dedupedBars.map((b, i) => ({ time: times[i], value: b.macd.dea })));
    }

    // ── RSI 副图 ──────────────────────────────────────────────────
    if (rsiChart) {
      const rsiSeries = rsiChart.addSeries(LineSeries, { color: '#9c27b0', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      rsiSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      rsiSeries.setData(
        dedupedBars.filter((b) => b.rsi.rsi6 != null).map((b) => ({ time: toChartTime(b.time), value: b.rsi.rsi6! })),
      );
    }

    if (isTimeshare) {
      // 分时图靠左对齐：固定逻辑范围覆盖 buildTimeshareData 全部 331 个时间槽（09:30–15:00）
      // fitContent 只 fit 有 value 的真实 bar，不含 WhitespaceData，会导致内容贴右；用精确逻辑范围替代
      const fullRange = { from: 0, to: TIMESHARE_SLOTS - 1 };
      mainChart.timeScale().setVisibleLogicalRange(fullRange);
      subCharts.forEach((c) => c.timeScale().setVisibleLogicalRange(fullRange));
    } else {
      mainChart.timeScale().fitContent();
      subCharts.forEach((c) => c.timeScale().fitContent());
      try {
        const saved = localStorage.getItem(`stockListKline:range:${currentPeriod}`);
        if (saved) {
          const r = JSON.parse(saved) as { from: number; to: number };
          if (typeof r.from === 'number' && typeof r.to === 'number') {
            const barMax = dedupedBars.length - 1;
            if (r.to < barMax) {
              const width = r.to - r.from;
              mainChart.timeScale().setVisibleLogicalRange({ from: barMax - width, to: barMax });
            } else {
              mainChart.timeScale().setVisibleLogicalRange(r);
            }
          }
        }
      } catch { /* ignore */ }
    }

    // 等下一帧读取各图实际价格轴宽度，取最大值统一对齐右边距
    const rafId = requestAnimationFrame(() => {
      const allCharts = [mainChart, ...subCharts, ...(darkTradeChart ? [darkTradeChart] : [])];
      const maxWidth = Math.max(...allCharts.map((c) => c.priceScale('right').width()));
      allCharts.forEach((c) => c.priceScale('right').applyOptions({ minimumWidth: maxWidth }));
    });

    // 图表重建完成，允许跨卡片同步和 localStorage 保存
    requestAnimationFrame(() => { isRebuildingRef.current = false; });

    return () => {
      cancelAnimationFrame(rafId);
      mainChart.remove();
      mainChartRef.current = null;
      volumeChart?.remove();
      macdChart?.remove();
      rsiChart?.remove();
      darkTradeChart?.remove();
      darkTradeChartRef.current = null;
      dtSeriesRef.current = [];
    };
  }, [bars, overlay, showVolume, showMacd, showRsi, showDarkTrade, populateDarkTradeData]);

  // 快照数据更新时独立刷新暗盘副图，不触发主图重建
  useEffect(() => {
    darkTradeSnapshotsRef.current = darkTradeSnapshots ?? [];
    populateDarkTradeData();
  }, [darkTradeSnapshots, populateDarkTradeData]);

  const minSpinHeight =
    MAIN_HEIGHT +
    (showVolume ? VOLUME_HEIGHT : 0) +
    (showMacd ? MACD_HEIGHT : 0) +
    (showRsi ? RSI_HEIGHT : 0) +
    (showDarkTrade ? DT_HEIGHT : 0);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Link to={`/stock/${market}/${code}`} className={styles.cardName}>
          {name}
        </Link>
        <span className={styles.cardMeta}>
          {code} · {market === 'HK' ? '港股' : 'A股'}
        </span>
        {currentPrice != null && (
          <span className={todayChange != null ? (todayChange >= 0 ? styles.changeUp : styles.changeDown) : styles.cardMeta}>
            {currentPrice.toFixed(2)}
          </span>
        )}
        {todayChange != null && (
          <span className={todayChange >= 0 ? styles.changeUp : styles.changeDown}>
            {todayChange > 0 ? '+' : ''}{todayChange.toFixed(2)}%
          </span>
        )}
        {hasDarkData && (lightCapital != null || darkCapital != null) && (
          <div className={styles.darkTradeGroup}>
            {lightCapital != null && (
              <Tag
                color={lightCapital > 0 ? '#ef5350' : lightCapital < 0 ? '#26a69a' : '#999'}
                className={styles.darkTradeTag}
              >
                明盘 {formatCapital(lightCapital)}
              </Tag>
            )}
            {darkCapital != null && (
              <Tag
                className={styles.darkTradeTag}
                style={{
                  background: 'transparent',
                  color: darkCapital > 0 ? '#ef5350' : darkCapital < 0 ? '#26a69a' : '#999',
                  border: `1px solid ${darkCapital > 0 ? '#ef5350' : darkCapital < 0 ? '#26a69a' : '#999'}`,
                }}
              >
                暗盘 {formatCapital(darkCapital)}
                {darkTradeData?.darkActivity != null && (
                  <span style={{ opacity: 0.75 }}> ({+((darkTradeData.darkActivity * 100).toFixed(2))}%)</span>
                )}
              </Tag>
            )}
            {lightCapital != null && darkCapital != null && (() => {
              const total = lightCapital + darkCapital;
              return (
                <Tag
                  color={total > 0 ? '#ef5350' : total < 0 ? '#26a69a' : '#999'}
                  className={styles.darkTradeTag}
                >
                  总 {formatCapital(total)}
                </Tag>
              );
            })()}
          </div>
        )}
      </div>
      <Spin spinning={loading} style={{ display: 'block', minHeight: minSpinHeight }}>
        <div ref={mainRef} />
        {showVolume && <div ref={volumeRef} />}
        {showMacd && <div ref={macdRef} />}
        {showRsi && <div ref={rsiRef} />}
        {showDarkTrade && <div ref={darkTradeRef} />}
      </Spin>
    </div>
  );
});

export default StockKlineCard;
