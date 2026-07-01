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
import type { IChartApi, ISeriesApi, SeriesType, LogicalRange, Time, LineData, HistogramData } from 'lightweight-charts';
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
  onDateResolved?: (date: string) => void;
}

const MAIN_HEIGHT = 150;
// 分时图全天时间槽总数：上午 121(09:30–11:30) + 下午 120(13:01–15:00)，午休不画
const TIMESHARE_SLOTS = 241;
const VOLUME_HEIGHT = 50;
const MACD_HEIGHT = 70;
const RSI_HEIGHT = 50;
const DT_HEIGHT = 75;
// 明暗盘副图颜色（与股票详情页 KLineChart 保持一致）
const DT_LIGHT_COLOR = '#1677ff';  // 明盘：蓝色
const DT_DARK_COLOR = '#fadb14';   // 暗盘：黄色
const DT_ZERO_COLOR = '#bbb';      // 零轴：浅灰

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
  rightPriceScale: { borderColor: '#e0e0e0', minimumWidth: 60 },
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

// 生成 09:30–15:00 全天 241 槽位数据（WhitespaceData 占位），供暗盘副图横坐标对齐主图
function buildTimeshare241(
  dataMap: Map<string, number>,
  date: string,
): ({ time: Time; value: number } | { time: Time })[] {
  const result: ({ time: Time; value: number } | { time: Time })[] = [];
  const fill = (fromMin: number, toMin: number) => {
    for (let m = fromMin; m <= toMin; m++) {
      const t = `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const v = dataMap.get(t);
      result.push(v !== undefined ? { time: toChartTime(t), value: v } : { time: toChartTime(t) });
    }
  };
  fill(9 * 60 + 30, 11 * 60 + 30);
  fill(13 * 60 + 1, 15 * 60);
  return result;
}

// 通用的分时 241 槽位数据生成器，使所有副图（MACD、成交量等）能与主图完美时间对齐
function buildTimeshareSeriesData<T extends { time: string }, R>(
  bars: T[],
  lastDate: string,
  mapFn: (bar: T, index: number) => R,
): (({ time: Time } & R) | { time: Time })[] {
  const barMap = new Map<string, { bar: T; idx: number }>();
  bars.forEach((b, i) => {
    barMap.set(b.time, { bar: b, idx: i });
  });
  const result: (({ time: Time } & R) | { time: Time })[] = [];
  const addRange = (fromMin: number, toMin: number) => {
    for (let m = fromMin; m <= toMin; m++) {
      const t = `${lastDate} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const entry = barMap.get(t);
      if (entry !== undefined) {
        result.push({ time: toChartTime(t), ...mapFn(entry.bar, entry.idx) });
      } else {
        result.push({ time: toChartTime(t) });
      }
    }
  };
  addRange(9 * 60 + 30, 11 * 60 + 30);
  addRange(13 * 60 + 1, 15 * 60);
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
  { code, market, name, period, overlay, showVolume, showMacd, showRsi, showDarkTrade, darkTradeData, darkTradeSnapshots, onRangeChange, onDateResolved },
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
  const volumeChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const alignWidthRafRef = useRef<number | null>(null);
  const dtSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const darkTradeSnapshotsRef = useRef<DarkTradeSnapshot[]>([]);
  const lastDateRef = useRef<string>('');
  const syncingRef = useRef(false);
  const isLockedRef = useRef(false);
  const onRangeChangeRef = useRef(onRangeChange);
  useEffect(() => { onRangeChangeRef.current = onRangeChange; });
  const periodRef = useRef(period);
  useEffect(() => { periodRef.current = period; });
  const isRebuildingRef = useRef(false);

  const alignPriceAxisWidth = useCallback(() => {
    if (alignWidthRafRef.current !== null) cancelAnimationFrame(alignWidthRafRef.current);
    alignWidthRafRef.current = requestAnimationFrame(() => {
      alignWidthRafRef.current = null;
      const liveCharts: IChartApi[] = [
        mainChartRef.current,
        volumeChartRef.current,
        macdChartRef.current,
        rsiChartRef.current,
        darkTradeChartRef.current,
      ].filter((c): c is IChartApi => c != null);
      if (liveCharts.length === 0) return;
      let maxWidth = Math.max(...liveCharts.map((c) => c.priceScale('right').width()));
      if (maxWidth < 60) {
        maxWidth = 60;
      }
      liveCharts.forEach((c) => c.priceScale('right').applyOptions({ minimumWidth: maxWidth }));
      // 价格轴宽度变化后重新锁定暗盘副图的逻辑范围，避免 applyOptions 触发重排后靠右贴边
      if (darkTradeChartRef.current) {
        darkTradeChartRef.current.timeScale().setVisibleLogicalRange({ from: 0, to: TIMESHARE_SLOTS - 1 });
      }
    });
  }, []);

  const populateDarkTradeData = useCallback(() => {
    const chart = darkTradeChartRef.current;
    if (!chart) return;
    dtSeriesRef.current.forEach((s) => chart.removeSeries(s));
    dtSeriesRef.current = [];

    const date = lastDateRef.current;
    const seen = new Set<string>();
    const snaps = darkTradeSnapshotsRef.current.filter((s) => {
      if (seen.has(s.time)) return false;
      seen.add(s.time);
      return true;
    });
    if (snaps.length === 0 || !date) {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: TIMESHARE_SLOTS - 1 });
      return;
    }

    // 明盘/暗盘/总资金不按正负拆分，各画一条完整折线（与详情页 KLineChart 对齐）
    const lightMap = new Map<string, number>();
    const darkMap = new Map<string, number>();
    const totalMap = new Map<string, number>();
    for (const s of snaps) {
      if (s.lightCapital != null) lightMap.set(s.time, s.lightCapital);
      if (s.darkCapital != null) darkMap.set(s.time, s.darkCapital);
      if (s.lightCapital != null || s.darkCapital != null) {
        totalMap.set(s.time, (s.lightCapital ?? 0) + (s.darkCapital ?? 0));
      }
    }

    let zeroLineAdded = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const symmetricAutoscale = (original: any) => {
      const res = original();
      if (res === null) return res;
      const maxAbs = Math.max(Math.abs(res.priceRange.maxValue), Math.abs(res.priceRange.minValue), 1);
      return { priceRange: { minValue: -maxAbs, maxValue: maxAbs } };
    };
    const addLine = (color: string, dataMap: Map<string, number>, needZeroLine = false) => {
      if (dataMap.size === 0 && snaps.length > 0) return;
      const series = chart.addSeries(LineSeries, {
        color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false,
        autoscaleInfoProvider: symmetricAutoscale,
      });
      series.priceScale().applyOptions({ scaleMargins: { top: 0.02, bottom: 0.02 } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      series.setData(buildTimeshare241(dataMap, date) as any);
      if (needZeroLine && !zeroLineAdded) {
        series.createPriceLine({ price: 0, color: DT_ZERO_COLOR, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
        zeroLineAdded = true;
      }
      dtSeriesRef.current.push(series);
    };


    // 明盘蓝线 + 暗盘黄线 + 总中灰折线，与详情页 KLineChart 完全一致
    addLine(DT_LIGHT_COLOR, lightMap, true);
    addLine(DT_DARK_COLOR, darkMap);
    addLine('#888', totalMap);

    // 与主图同用 242 逻辑索引，不用 fitContent
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: TIMESHARE_SLOTS - 1 });
    alignPriceAxisWidth();
  }, [alignPriceAxisWidth]);

  useImperativeHandle(ref, () => ({
    setRange: (range: LogicalRange) => {
      isLockedRef.current = true;
      mainChartRef.current?.timeScale().setVisibleLogicalRange(range);
      requestAnimationFrame(() => { isLockedRef.current = false; });
    },
  }));

  const onDateResolvedRef = useRef(onDateResolved);
  useEffect(() => { onDateResolvedRef.current = onDateResolved; });

  // Effect 1: 拉取 K 线数据（period/code/market 变化时重新拉取）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBars([]);
    klineApi
      .get(market, code, period)
      .then((res) => {
        if (!cancelled) {
          setBars(res.data);
          if (res.data.length > 0) {
            const date = res.data[res.data.length - 1].time.slice(0, 10).replace(/-/g, '');
            onDateResolvedRef.current?.(date);
          }
        }
      })
      .catch(() => { })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, market, period]);

  // Effect 3: 交易时段内 30 秒轮询刷新（只在数据实际变化时触发重绘）
  useEffect(() => {
    if (period === 'timeshare') return;
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
        .catch(() => { });
    }, 30000);
    return () => clearInterval(timer);
  }, [code, market, period]);

  // Effect 2: 渲染图表（bars/overlay/副图开关变化时重绘，不重新拉取数据）
  useEffect(() => {
    if (!mainRef.current || bars.length === 0) return;

    isRebuildingRef.current = true;
    const currentPeriod = periodRef.current;
    const isTimeshare = currentPeriod === 'timeshare';
    const latestDate = isTimeshare && bars.length > 0 ? bars[bars.length - 1].time.slice(0, 10) : '';
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
      volumeChartRef.current = volumeChart;
    }
    if (showMacd && macdRef.current) {
      macdChart = createChart(macdRef.current, {
        ...CHART_BASE,
        ...interactionOpts,
        autoSize: true,
        height: MACD_HEIGHT,
        timeScale: { ...CHART_BASE.timeScale, visible: false, fixRightEdge: !isTimeshare },
      });
      macdChartRef.current = macdChart;
    }
    if (showRsi && rsiRef.current) {
      rsiChart = createChart(rsiRef.current, {
        ...CHART_BASE,
        ...interactionOpts,
        autoSize: true,
        height: RSI_HEIGHT,
        timeScale: { ...CHART_BASE.timeScale, visible: false, fixRightEdge: !isTimeshare },
      });
      rsiChartRef.current = rsiChart;
    }

    if (showDarkTrade && darkTradeRef.current) {
      darkTradeChart = createChart(darkTradeRef.current, {
        ...CHART_BASE,
        rightPriceScale: {
          ...CHART_BASE.rightPriceScale,
          entireTextOnly: false,
        },
        autoSize: true,
        height: DT_HEIGHT,
        handleScroll: false,
        handleScale: false,
        timeScale: { ...CHART_BASE.timeScale, visible: false, fixRightEdge: false },
        localization: {
          priceFormatter: (v: number) => {
            const abs = Math.abs(v);
            const str = abs >= 1e7 ? +(v / 1e8).toFixed(2) + '亿'
                      : abs >= 1e4 ? (v / 1e4).toFixed(0) + '万'
                      : v.toFixed(0);
            return str + '    ';
          },
        },
      });
      darkTradeChartRef.current = darkTradeChart;
      dtSeriesRef.current = [];
      lastDateRef.current = bars.length > 0 ? bars[bars.length - 1].time.slice(0, 10) : '';
      populateDarkTradeData();
    }

    const subCharts = [volumeChart, macdChart, rsiChart, darkTradeChart].filter(Boolean) as IChartApi[];
    const allCharts = [mainChart, ...subCharts];

    let mainSeries: ISeriesApi<SeriesType> | null = null;
    let volumeSeries: ISeriesApi<'Histogram'> | null = null;
    let macdSeries: ISeriesApi<'Histogram'> | null = null;
    let rsiSeriesLocal: ISeriesApi<'Line'> | null = null;

    const primarySeriesMap = new Map<IChartApi, () => ISeriesApi<SeriesType> | null>();
    primarySeriesMap.set(mainChart, () => mainSeries);
    if (volumeChart) primarySeriesMap.set(volumeChart, () => volumeSeries);
    if (macdChart) primarySeriesMap.set(macdChart, () => macdSeries);
    if (rsiChart) primarySeriesMap.set(rsiChart, () => rsiSeriesLocal);
    if (darkTradeChart) {
      primarySeriesMap.set(darkTradeChart, () => dtSeriesRef.current[0] || null);
    }

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

    // 十字光标联动：任一图表移动时，在其余图表同步定位十字光标
    allCharts.forEach((chart) => {
      chart.subscribeCrosshairMove((param) => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        allCharts.forEach((other) => {
          if (other === chart) return;
          const series = primarySeriesMap.get(other)?.();
          if (param.time && series) {
            try {
              other.setCrosshairPosition(0, param.time, series);
            } catch {
              // 忽略空数据或空白槽位报错
            }
          } else if (!param.time) {
            other.clearCrosshairPosition();
          }
        });
        syncingRef.current = false;
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
      let zeroPrice = dedupedBars[0].open;
      if (dedupedBars[0].changePercent != null) {
        zeroPrice = dedupedBars[0].close / (1 + dedupedBars[0].changePercent / 100);
      }
      const areaSeries = mainChart.addSeries(AreaSeries, {
        topColor: 'rgba(22, 119, 255, 0.28)',
        bottomColor: 'rgba(22, 119, 255, 0)',
        lineColor: '#1677ff',
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        autoscaleInfoProvider: (original: any) => {
          const res = original();
          if (res !== null && zeroPrice > 0) {
            const delta = Math.max(
              Math.abs(res.priceRange.maxValue - zeroPrice),
              Math.abs(res.priceRange.minValue - zeroPrice)
            );
            return {
              priceRange: {
                minValue: zeroPrice - delta,
                maxValue: zeroPrice + delta,
              },
            };
          }
          return res;
        },
      });
      areaSeries.setData(latestDate ? (buildTimeshareSeriesData(dedupedBars, latestDate, (b) => ({ value: b.close })) as unknown as LineData[]) : []);
      mainSeries = areaSeries;
      if (zeroPrice > 0) {
        areaSeries.createPriceLine({
          price: zeroPrice,
          color: 'rgba(150, 150, 150, 0.45)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
      }
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
      mainSeries = candleSeries;

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
      if (isTimeshare && latestDate) {
        volSeries.setData(
          buildTimeshareSeriesData(dedupedBars, latestDate, (b, i) => ({
            value: b.volume,
            color: i > 0 ? (b.close >= dedupedBars[i - 1].close ? '#ef5350' : '#26a69a') : '#ef5350',
          })) as unknown as HistogramData[]
        );
      } else {
        volSeries.setData(
          dedupedBars.map((b, i) => ({ time: times[i], value: b.volume, color: b.close >= b.open ? '#ef5350' : '#26a69a' })),
        );
      }
      volumeSeries = volSeries;
    }

    // ── MACD 副图 ─────────────────────────────────────────────────
    if (macdChart) {
      const macdHist = macdChart.addSeries(HistogramSeries, {
        lastValueVisible: false,
        priceLineVisible: false,
      });
      macdHist.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0.2 } });
      if (isTimeshare && latestDate) {
        macdHist.setData(
          buildTimeshareSeriesData(dedupedBars, latestDate, (b) => ({
            value: b.macd.bar,
            color: b.macd.bar >= 0 ? '#ef5350' : '#26a69a',
          })) as unknown as HistogramData[]
        );
      } else {
        macdHist.setData(
          dedupedBars.map((b) => ({ time: toChartTime(b.time), value: b.macd.bar, color: b.macd.bar >= 0 ? '#ef5350' : '#26a69a' })),
        );
      }
      macdSeries = macdHist;

      const difSeries = macdChart.addSeries(LineSeries, { color: '#1677ff', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      if (isTimeshare && latestDate) {
        difSeries.setData(
          buildTimeshareSeriesData(dedupedBars, latestDate, (b) => ({ value: b.macd.dif })) as unknown as LineData[]
        );
      } else {
        difSeries.setData(dedupedBars.map((b, i) => ({ time: times[i], value: b.macd.dif })));
      }

      const deaSeries = macdChart.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      if (isTimeshare && latestDate) {
        deaSeries.setData(
          buildTimeshareSeriesData(dedupedBars, latestDate, (b) => ({ value: b.macd.dea })) as unknown as LineData[]
        );
      } else {
        deaSeries.setData(dedupedBars.map((b, i) => ({ time: times[i], value: b.macd.dea })));
      }
    }

    // ── RSI 副图 ──────────────────────────────────────────────────
    if (rsiChart) {
      const rsiSeries = rsiChart.addSeries(LineSeries, { color: '#9c27b0', lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      rsiSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      if (isTimeshare && latestDate) {
        rsiSeries.setData(
          buildTimeshareSeriesData(dedupedBars, latestDate, (b) => ({ value: b.rsi.rsi6 })) as unknown as LineData[]
        );
      } else {
        rsiSeries.setData(
          dedupedBars.filter((b) => b.rsi.rsi6 != null).map((b) => ({ time: toChartTime(b.time), value: b.rsi.rsi6! })),
        );
      }
      rsiSeriesLocal = rsiSeries;
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
    alignPriceAxisWidth();

    // 图表重建完成，允许跨卡片同步和 localStorage 保存
    requestAnimationFrame(() => { isRebuildingRef.current = false; });

    return () => {
      if (alignWidthRafRef.current !== null) cancelAnimationFrame(alignWidthRafRef.current);
      mainChart.remove();
      mainChartRef.current = null;
      volumeChart?.remove();
      volumeChartRef.current = null;
      macdChart?.remove();
      macdChartRef.current = null;
      rsiChart?.remove();
      rsiChartRef.current = null;
      darkTradeChart?.remove();
      darkTradeChartRef.current = null;
      dtSeriesRef.current = [];
    };
  }, [bars, overlay, showVolume, showMacd, showRsi, showDarkTrade, populateDarkTradeData, alignPriceAxisWidth]);

  // 快照数据更新时独立刷新暗盘副图，不触发主图重建
  useEffect(() => {
    darkTradeSnapshotsRef.current = darkTradeSnapshots ?? [];
    if (bars.length > 0) lastDateRef.current = bars[bars.length - 1].time.slice(0, 10);
    populateDarkTradeData();
  }, [darkTradeSnapshots, bars, populateDarkTradeData]);

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
        {hasDarkData && (lightCapital != null || darkCapital != null) && (() => {
          const total = (lightCapital ?? 0) + (darkCapital ?? 0);
          const hasTotal = lightCapital != null && darkCapital != null;
          const tagColor = hasTotal
            ? total > 0 ? '#ef5350' : total < 0 ? '#26a69a' : '#999'
            : '#999';
          const parts: string[] = [];
          if (lightCapital != null) parts.push(`明${formatCapital(lightCapital)}`);
          if (darkCapital != null) {
            const act = darkTradeData?.darkActivity != null
              ? `(${+(darkTradeData.darkActivity * 100).toFixed(2)}%)`
              : '';
            parts.push(`暗${formatCapital(darkCapital)}${act}`);
          }
          if (hasTotal) parts.push(`总${formatCapital(total)}`);
          return (
            <Tag color={tagColor} className={styles.darkTradeTag}>
              {parts.join('·')}
            </Tag>
          );
        })()}
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
