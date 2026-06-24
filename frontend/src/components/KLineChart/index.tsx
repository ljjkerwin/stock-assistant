import { useEffect, useRef, useCallback, useState } from 'react';
import { Tabs, Spin, message } from 'antd';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  HistogramData,
  SeriesType,
  SeriesMarker,
  Time,
  Logical,
  LogicalRange,
} from 'lightweight-charts';
import { klineApi } from '../../api/stock';
import type { KlinePeriod, KlineBar } from '../../types';
import { PERIOD_LABELS } from '../../types';
import styles from './KLineChart.module.css';

interface Props {
  market: 'A' | 'HK';
  code: string;
  initialData?: { data: KlineBar[]; period?: KlinePeriod; backtestStartTime?: string | null };
  zoomStorageKey?: string;
  showPeriodTabs?: boolean;
  // 外部受控周期：无 initialData 的拉取模式下指定周期（配合 showPeriodTabs=false 使用，如回测页预览）
  period?: KlinePeriod;
  showLjj?: boolean; // 显示 ljj 自定义副图（综合属性堆叠柱状图），仅策略回测页使用
  showRsi?: boolean; // 显示常规 RSI 副图（RSI6 曲线），仅策略回测页使用
  // 回测预览：拉取模式下将默认视口对齐到回测时间区间 [viewStartDate, viewEndDate]（YYYY-MM-DD），
  // 使点击「开始回测」后视口不跳变；仅在无 initialData 的拉取模式下生效
  viewStartDate?: string;
  viewEndDate?: string;
}

// ljj 副图属性颜色
const LJJ_MACD_COLOR = '#ff9800'; // 属性 KMACD，位于柱底
const LJJ_RSI_COLOR = '#1677ff'; // 属性 KRSI，叠加在中部
const LJJ_MA_COLOR = '#52c41a'; // 属性 KMA，叠加在顶部

// 常规 RSI 副图曲线颜色
const RSI_LINE_COLOR = '#9C27B0';

// 主图叠加内容：均线 或 BOLL 布林带
type MainOverlay = 'ma' | 'boll';
const OVERLAY_STORAGE_KEY = 'kline:overlay';

// BOLL 三轨颜色
const BOLL_UP_COLOR = '#FF6D00'; // 上轨
const BOLL_MID_COLOR = '#1677FF'; // 中轨（MA20）
const BOLL_LOW_COLOR = '#9C27B0'; // 下轨

function loadOverlay(): MainOverlay {
  try {
    return localStorage.getItem(OVERLAY_STORAGE_KEY) === 'boll' ? 'boll' : 'ma';
  } catch {
    return 'ma';
  }
}

const PERIODS = Object.keys(PERIOD_LABELS) as KlinePeriod[];

function fmtVol(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(0);
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '--';
  return v.toFixed(3);
}

const CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: '#ffffff' },
    textColor: '#333',
    attributionLogo: false,
  },
  grid: {
    vertLines: { color: '#f0f0f0' },
    horzLines: { color: '#f0f0f0' },
  },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#e0e0e0' },
  timeScale: { borderColor: '#e0e0e0', timeVisible: true, fixRightEdge: true },
};

// Treat UTC+8 datetime strings as UTC so the chart axis shows CST times directly.
function toChartTime(t: string): number | string {
  if (!t.includes(' ')) return t;
  const [date, time] = t.split(' ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 1000;
}

function isInTradingHours(market: 'A' | 'HK'): boolean {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
  const h = utc8.getUTCHours();
  const m = utc8.getUTCMinutes();
  const day = utc8.getUTCDay();
  if (day === 0 || day === 6) return false;
  const t = h * 60 + m;
  if (market === 'A') {
    return (t >= 570 && t < 690) || (t >= 780 && t < 900);
  }
  return (t >= 570 && t < 720) || (t >= 780 && t < 960);
}

export default function KLineChart({ market, code, initialData, zoomStorageKey, showPeriodTabs = true, showLjj = false, showRsi = false, period: controlledPeriod, viewStartDate, viewEndDate }: Props) {
  const [period, setPeriod] = useState<KlinePeriod>(initialData?.period ?? controlledPeriod ?? 'timeshare');
  const [loading, setLoading] = useState(false);
  const [overlay, setOverlay] = useState<MainOverlay>(loadOverlay);

  const containerRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const ljjRef = useRef<HTMLDivElement>(null);

  const mainChartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const ljjChartRef = useRef<IChartApi | null>(null);

  const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const difSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const deaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdBarSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ljjTotalSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ljjMidSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ljjBottomSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma10SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollMidSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alignWidthRafRef = useRef<number | null>(null);
  const syncingRef = useRef(false);
  const zoomStorageKeyRef = useRef<string | undefined>(undefined);
  const zoomSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewStartDateRef = useRef<string | undefined>(undefined);
  const viewEndDateRef = useRef<string | undefined>(undefined);

  // Data refs — used by legend updater to look up values by time
  const barsRef = useRef<KlineBar[]>([]);
  const chartTimesRef = useRef<(number | string)[]>([]);
  const periodRef = useRef<KlinePeriod>('timeshare');
  const overlayRef = useRef<MainOverlay>(overlay);

  // Legend DOM refs
  const mainLegendRef = useRef<HTMLDivElement>(null);
  const volLegendRef = useRef<HTMLDivElement>(null);
  const macdLegendRef = useRef<HTMLDivElement>(null);
  const rsiLegendRef = useRef<HTMLDivElement>(null);
  const ljjLegendRef = useRef<HTMLDivElement>(null);

  const initCharts = useCallback(() => {
    if (!containerRef.current || !volumeRef.current || !macdRef.current) return;
    if (showRsi && !rsiRef.current) return;
    if (showLjj && !ljjRef.current) return;

    if (alignWidthRafRef.current !== null) {
      cancelAnimationFrame(alignWidthRafRef.current);
      alignWidthRafRef.current = null;
    }
    [mainChartRef, volumeChartRef, macdChartRef, rsiChartRef, ljjChartRef].forEach((ref) => {
      ref.current?.remove();
      ref.current = null;
    });

    const noTimeScale = { timeScale: { ...CHART_OPTIONS.timeScale, visible: false } };
    const mainChart = createChart(containerRef.current, { ...CHART_OPTIONS, height: 300 });
    mainChartRef.current = mainChart;

    const volumeChart = createChart(volumeRef.current, { ...CHART_OPTIONS, ...noTimeScale, height: 80 });
    volumeChartRef.current = volumeChart;

    const macdChart = createChart(macdRef.current, { ...CHART_OPTIONS, ...noTimeScale, height: 80 });
    macdChartRef.current = macdChart;

    let rsiChart: IChartApi | null = null;
    if (showRsi && rsiRef.current) {
      rsiChart = createChart(rsiRef.current, { ...CHART_OPTIONS, ...noTimeScale, height: 80 });
      rsiChartRef.current = rsiChart;
    }

    let ljjChart: IChartApi | null = null;
    if (showLjj && ljjRef.current) {
      ljjChart = createChart(ljjRef.current, { ...CHART_OPTIONS, ...noTimeScale, height: 80 });
      ljjChartRef.current = ljjChart;
    }

    // 参与时间轴 / 十字光标联动的全部图表
    const charts: IChartApi[] = [mainChart, volumeChart, macdChart];
    if (rsiChart) charts.push(rsiChart);
    if (ljjChart) charts.push(ljjChart);

    // 各图主 series 引用（用于十字光标定位），在 applyData 后填充
    const primarySeriesRefs = new Map<IChartApi, () => ISeriesApi<SeriesType> | null>([
      [mainChart, () => mainSeriesRef.current],
      [volumeChart, () => volumeSeriesRef.current],
      [macdChart, () => difSeriesRef.current],
    ]);
    if (rsiChart) primarySeriesRefs.set(rsiChart, () => rsiSeriesRef.current);
    if (ljjChart) primarySeriesRefs.set(ljjChart, () => ljjTotalSeriesRef.current);

    // Unified legend updater — looks up bar by chart time and refreshes all three legends
    function updateAllLegends(time: Time) {
      const idx = chartTimesRef.current.findIndex((t) => t === time);
      if (idx < 0) return;
      const bar = barsRef.current[idx];
      const pd = periodRef.current;

      if (mainLegendRef.current) {
        if (pd === 'timeshare') {
          mainLegendRef.current.textContent = `价格: ${bar.close.toFixed(3)}`;
        } else {
          let maHtml = '';
          if (overlayRef.current === 'boll') {
            const b = bar.boll;
            if (b) {
              maHtml =
                `&nbsp;&nbsp;<span style="color:${BOLL_UP_COLOR}">UP:${b.upper?.toFixed(3) ?? '--'}</span>&nbsp;&nbsp;` +
                `<span style="color:${BOLL_MID_COLOR}">MB:${b.mid?.toFixed(3) ?? '--'}</span>&nbsp;&nbsp;` +
                `<span style="color:${BOLL_LOW_COLOR}">DN:${b.lower?.toFixed(3) ?? '--'}</span>`;
            }
          } else {
            const m = bar.ma;
            if (m) {
              maHtml =
                `&nbsp;&nbsp;<span style="color:#FFAB00">MA5:${m.ma5?.toFixed(3) ?? '--'}</span>&nbsp;&nbsp;` +
                `<span style="color:#E91E63">MA10:${m.ma10?.toFixed(3) ?? '--'}</span>&nbsp;&nbsp;` +
                `<span style="color:#1677FF">MA20:${m.ma20?.toFixed(3) ?? '--'}</span>&nbsp;&nbsp;` +
                `<span style="color:#9C27B0">MA60:${m.ma60?.toFixed(3) ?? '--'}</span>`;
            }
          }
          // 当日涨跌幅：优先用后端返回的 changePercent，缺失时回退按前一根收盘价计算，红涨绿跌
          let pct = bar.changePercent ?? null;
          if (pct == null && idx > 0) {
            const prevClose = barsRef.current[idx - 1].close;
            if (prevClose !== 0) pct = ((bar.close - prevClose) / prevClose) * 100;
          }
          let chgHtml = '';
          if (pct != null) {
            const color = pct >= 0 ? '#ef5350' : '#26a69a';
            const sign = pct >= 0 ? '+' : '';
            chgHtml = `&nbsp;&nbsp;<span style="color:${color}">涨跌幅:${sign}${pct.toFixed(2)}%</span>`;
          }
          mainLegendRef.current.innerHTML =
            `<span>开:${bar.open.toFixed(3)}</span>&nbsp;&nbsp;` +
            `<span>高:${bar.high.toFixed(3)}</span>&nbsp;&nbsp;` +
            `<span>低:${bar.low.toFixed(3)}</span>&nbsp;&nbsp;` +
            `<span>收:${bar.close.toFixed(3)}</span>` +
            chgHtml +
            maHtml;
        }
      }

      if (volLegendRef.current) {
        volLegendRef.current.textContent = `VOL: ${fmtVol(bar.volume)}`;
      }

      if (macdLegendRef.current) {
        const barColor = bar.macd.bar >= 0 ? '#ef5350' : '#26a69a';
        macdLegendRef.current.innerHTML =
          `<span style="color:#1677ff">DIF:${fmtNum(bar.macd.dif)}</span>&nbsp;&nbsp;` +
          `<span style="color:#ff9800">DEA:${fmtNum(bar.macd.dea)}</span>&nbsp;&nbsp;` +
          `<span style="color:${barColor}">MACD:${fmtNum(bar.macd.bar)}</span>`;
      }

      if (rsiLegendRef.current) {
        rsiLegendRef.current.innerHTML = `<span style="color:${RSI_LINE_COLOR}">RSI6:${fmtNum(bar.rsi?.rsi6)}</span>`;
      }

      if (ljjLegendRef.current) {
        const a = bar.attrs;
        ljjLegendRef.current.innerHTML =
          `<span style="color:${LJJ_MACD_COLOR}">KMACD:${a?.kmacd ? '✓' : '✗'}</span>&nbsp;&nbsp;` +
          `<span style="color:${LJJ_RSI_COLOR}">KRSI:${a?.krsi ? '✓' : '✗'}</span>&nbsp;&nbsp;` +
          `<span style="color:${LJJ_MA_COLOR}">KMA:${a?.kma ? '✓' : '✗'}</span>`;
      }
    }

    // 时间轴范围联动：任一图表缩放/平移时同步其余图表，主图额外持久化 zoom
    charts.forEach((chart) => {
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return;
        charts.forEach((other) => {
          if (other !== chart) other.timeScale().setVisibleLogicalRange(range);
        });
        if (chart === mainChart && zoomStorageKeyRef.current) {
          if (zoomSaveTimerRef.current) clearTimeout(zoomSaveTimerRef.current);
          zoomSaveTimerRef.current = setTimeout(() => {
            try {
              localStorage.setItem(`kline:zoom:${zoomStorageKeyRef.current!}`, JSON.stringify(range));
            } catch { /* localStorage unavailable */ }
          }, 500);
        }
      });
    });

    // 十字光标联动：任一图表移动时同步刷新所有 legend 并在其余图表定位光标
    charts.forEach((chart) => {
      chart.subscribeCrosshairMove((param) => {
        if (param.time) updateAllLegends(param.time);
        if (syncingRef.current) return;
        syncingRef.current = true;
        charts.forEach((other) => {
          if (other === chart) return;
          const series = primarySeriesRefs.get(other)?.();
          if (param.time && series) {
            other.setCrosshairPosition(0, param.time, series);
          } else if (!param.time) {
            other.clearCrosshairPosition();
          }
        });
        syncingRef.current = false;
      });
    });
  }, [showLjj, showRsi]);

  const applyData = useCallback((bars: KlineBar[], pd: KlinePeriod, preserveViewport = false, backtestStartTime?: string | null) => {
    if (!mainChartRef.current || !volumeChartRef.current || !macdChartRef.current) return;

    // 所有已激活的图表（RSI、ljj 为可选副图）
    const activeCharts: IChartApi[] = [mainChartRef.current, volumeChartRef.current, macdChartRef.current];
    if (rsiChartRef.current) activeCharts.push(rsiChartRef.current);
    if (ljjChartRef.current) activeCharts.push(ljjChartRef.current);
    const setAllRange = (range: LogicalRange) => activeCharts.forEach((c) => c.timeScale().setVisibleLogicalRange(range));
    const fitAll = () => activeCharts.forEach((c) => c.timeScale().fitContent());

    // Save current viewport before clearing series so it can be restored after refresh
    let savedRange: LogicalRange | null = null;
    if (preserveViewport) {
      savedRange = mainChartRef.current.timeScale().getVisibleLogicalRange();
    }

    const isTimeshare = pd === 'timeshare';
    const interactionOpts = isTimeshare
      ? { handleScale: false, handleScroll: false }
      : { handleScale: true, handleScroll: true };
    activeCharts.forEach((c) => c.applyOptions(interactionOpts));

    if (isTimeshare && bars.length > 0) {
      const latestDate = bars[bars.length - 1].time.split(' ')[0];
      bars = bars.filter((b) => b.time.startsWith(latestDate));
    }

    // Store data for legend lookup
    barsRef.current = bars;
    chartTimesRef.current = bars.map((b) => toChartTime(b.time));
    periodRef.current = pd;

    if (mainSeriesRef.current) {
      mainChartRef.current.removeSeries(mainSeriesRef.current);
      mainSeriesRef.current = null;
    }
    [
      ma5SeriesRef,
      ma10SeriesRef,
      ma20SeriesRef,
      ma60SeriesRef,
      bollUpperSeriesRef,
      bollMidSeriesRef,
      bollLowerSeriesRef,
    ].forEach((ref) => {
      if (ref.current) {
        mainChartRef.current!.removeSeries(ref.current);
        ref.current = null;
      }
    });
    if (volumeSeriesRef.current) {
      volumeChartRef.current.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }
    [difSeriesRef, deaSeriesRef, macdBarSeriesRef].forEach((ref) => {
      if (ref.current) {
        macdChartRef.current!.removeSeries(ref.current);
        ref.current = null;
      }
    });
    if (rsiSeriesRef.current && rsiChartRef.current) {
      rsiChartRef.current.removeSeries(rsiSeriesRef.current);
      rsiSeriesRef.current = null;
    }
    [ljjTotalSeriesRef, ljjMidSeriesRef, ljjBottomSeriesRef].forEach((ref) => {
      if (ref.current && ljjChartRef.current) {
        ljjChartRef.current.removeSeries(ref.current);
        ref.current = null;
      }
    });

    if (pd === 'timeshare') {
      const lineSeries = mainChartRef.current.addSeries(LineSeries, {
        color: '#1677ff',
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      lineSeries.setData(bars.map((b) => ({ time: toChartTime(b.time), value: b.close } as LineData)));
      mainSeriesRef.current = lineSeries;
    } else {
      const candleSeries = mainChartRef.current.addSeries(CandlestickSeries, {
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
        bars.map(
          (b) =>
            ({ time: toChartTime(b.time), open: b.open, high: b.high, low: b.low, close: b.close } as CandlestickData),
        ),
      );
      mainSeriesRef.current = candleSeries;

      // 主图叠加：均线 或 BOLL 布林带（由 overlayRef 决定，可由顶部按钮切换并本地缓存）
      if (overlayRef.current === 'boll') {
        const bollConfigs = [
          { ref: bollUpperSeriesRef, key: 'upper' as const, color: BOLL_UP_COLOR },
          { ref: bollMidSeriesRef, key: 'mid' as const, color: BOLL_MID_COLOR },
          { ref: bollLowerSeriesRef, key: 'lower' as const, color: BOLL_LOW_COLOR },
        ];
        bollConfigs.forEach(({ ref, key, color }) => {
          const series = mainChartRef.current!.addSeries(LineSeries, {
            color,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          series.setData(
            bars
              .filter((b) => b.boll?.[key] != null)
              .map((b) => ({ time: toChartTime(b.time), value: b.boll[key]! } as LineData)),
          );
          ref.current = series;
        });
      } else {
        const maConfigs = [
          { ref: ma5SeriesRef, key: 'ma5' as const, color: '#FFAB00' },
          { ref: ma10SeriesRef, key: 'ma10' as const, color: '#E91E63' },
          { ref: ma20SeriesRef, key: 'ma20' as const, color: '#1677FF' },
          { ref: ma60SeriesRef, key: 'ma60' as const, color: '#9C27B0' },
        ];
        maConfigs.forEach(({ ref, key, color }) => {
          const series = mainChartRef.current!.addSeries(LineSeries, {
            color,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          series.setData(
            bars
              .filter((b) => b.ma[key] != null)
              .map((b) => ({ time: toChartTime(b.time), value: b.ma[key]! } as LineData)),
          );
          ref.current = series;
        });
      }
    }

    // Buy/sell markers (only present when data comes from strategy backtest)
    const markers: SeriesMarker<Time>[] = bars
      .filter((b) => b.signal === 'buy' || b.signal === 'sell')
      .map((b) =>
        b.signal === 'buy'
          ? { time: toChartTime(b.time) as Time, position: 'belowBar' as const, color: '#ef5350', shape: 'arrowUp' as const, text: '买' }
          : { time: toChartTime(b.time) as Time, position: 'aboveBar' as const, color: '#26a69a', shape: 'arrowDown' as const, text: '卖' },
      );

    // 回测起始标记
    if (backtestStartTime) {
      const startBar = bars.find((b) => b.time === backtestStartTime);
      if (startBar) {
        markers.unshift({
          time: toChartTime(startBar.time) as Time,
          position: 'belowBar' as const,
          color: '#1677ff',
          shape: 'square' as const,
          text: '回测起始',
        });
      }
    }

    // markers 必须按时间升序
    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

    if (markers.length > 0) {
      createSeriesMarkers(mainSeriesRef.current!, markers);
    }

    const volSeries = volumeChartRef.current.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volSeries.setData(
      bars.map(
        (b, i) =>
          ({
            time: toChartTime(b.time),
            value: b.volume,
            color: i > 0 ? (b.close >= bars[i - 1].close ? '#ef5350' : '#26a69a') : '#ef5350',
          } as HistogramData),
      ),
    );
    volumeSeriesRef.current = volSeries;

    const difSeries = macdChartRef.current.addSeries(LineSeries, {
      color: '#1677ff',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    difSeries.setData(bars.map((b) => ({ time: toChartTime(b.time), value: b.macd.dif } as LineData)));
    difSeriesRef.current = difSeries;

    const deaSeries = macdChartRef.current.addSeries(LineSeries, {
      color: '#ff9800',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    deaSeries.setData(bars.map((b) => ({ time: toChartTime(b.time), value: b.macd.dea } as LineData)));
    deaSeriesRef.current = deaSeries;

    const macdBarSeries = macdChartRef.current.addSeries(HistogramSeries, {
      priceScaleId: 'right',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    macdBarSeries.setData(
      bars.map(
        (b) =>
          ({
            time: toChartTime(b.time),
            value: b.macd.bar,
            color: b.macd.bar >= 0 ? '#ef5350' : '#26a69a',
          } as HistogramData),
      ),
    );
    macdBarSeriesRef.current = macdBarSeries;

    // 常规 RSI 副图：仅 RSI6 曲线
    if (rsiChartRef.current) {
      const rsiSeries = rsiChartRef.current.addSeries(LineSeries, {
        color: RSI_LINE_COLOR,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      rsiSeries.setData(
        bars
          .filter((b) => b.rsi?.rsi6 != null)
          .map((b) => ({ time: toChartTime(b.time), value: b.rsi!.rsi6! } as LineData)),
      );
      // 50 中轴虚线
      rsiSeries.createPriceLine({
        price: 50,
        color: '#999',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '50',
      });
      rsiSeriesRef.current = rsiSeries;
    }

    // ljj 副图：综合属性堆叠柱状图（属性由后端计算，见 KlineBar.attrs）
    // lightweight-charts 无原生堆叠，用 3 个 Histogram 叠加模拟：每根 K 线满足的属性
    // 按固定优先级 [KMACD 底 → KRSI 中 → KMA 顶] 自下而上紧凑堆叠，柱高 = 满足数(0~3)。
    // 画法：先画整柱(顶段色)，再依次覆盖较矮的中段、底段，露出各自颜色的色带。
    if (ljjChartRef.current) {
      // 优先级顺序：数组靠前者位于柱底
      const ljjOrder: { key: 'kmacd' | 'krsi' | 'kma'; color: string }[] = [
        { key: 'kmacd', color: LJJ_MACD_COLOR },
        { key: 'krsi', color: LJJ_RSI_COLOR },
        { key: 'kma', color: LJJ_MA_COLOR },
      ];
      // 每根 K 线满足属性的颜色（按优先级顺序，自底向上）
      const slotsPerBar = bars.map((b) => ljjOrder.filter((a) => b.attrs?.[a.key]).map((a) => a.color));

      // layer 0 在最底层（绘制顺序最先），显示顶段；layer 2 最后绘制，露出底段
      const makeLayer = (layer: number, ref: typeof ljjTotalSeriesRef) => {
        const series = ljjChartRef.current!.addSeries(HistogramSeries, {
          priceScaleId: 'right',
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(
          bars.map((b, i) => {
            const slots = slotsPerBar[i];
            const count = slots.length;
            const value = count > layer ? count - layer : 0;
            // 该层露出的色带对应自顶向下第 layer 个已满足属性
            const color = count > layer ? slots[count - 1 - layer] : LJJ_MACD_COLOR;
            return { time: toChartTime(b.time), value, color } as HistogramData;
          }),
        );
        ref.current = series;
      };
      makeLayer(0, ljjTotalSeriesRef);
      makeLayer(1, ljjMidSeriesRef);
      makeLayer(2, ljjBottomSeriesRef);
    }

    if (preserveViewport && savedRange) {
      setAllRange(savedRange);
    } else if (isTimeshare || bars.length === 0) {
      fitAll();
    } else if (viewStartDateRef.current && !backtestStartTime) {
      // 回测预览：默认视口对齐回测时间区间 [viewStartDate, viewEndDate]，
      // 优先于持久化 zoom，使点击回测后视口不跳到别的时间
      const startDay = viewStartDateRef.current;
      const endDay = viewEndDateRef.current;
      const startIdx = bars.findIndex((b) => b.time.slice(0, 10) >= startDay);
      let endIdx = bars.length - 1;
      if (endDay) {
        for (let i = bars.length - 1; i >= 0; i--) {
          if (bars[i].time.slice(0, 10) <= endDay) {
            endIdx = i;
            break;
          }
        }
      }
      // 与回测结果视图一致：起点前留 5 根历史上下文
      const from = startIdx >= 0 ? Math.max(0, startIdx - 5) : 0;
      setAllRange({ from: Math.min(from, endIdx) as Logical, to: endIdx as Logical });
    } else {
      // Restore persisted zoom if available
      let restoredZoom: LogicalRange | null = null;
      if (zoomStorageKeyRef.current) {
        try {
          const s = localStorage.getItem(`kline:zoom:${zoomStorageKeyRef.current}`);
          restoredZoom = s ? (JSON.parse(s) as LogicalRange) : null;
        } catch { /* localStorage unavailable */ }
      }

      if (restoredZoom) {
        setAllRange(restoredZoom);
      } else if (backtestStartTime) {
        // 回测模式：以回测起始点为锚，前留少量历史上下文
        const startIdx = bars.findIndex((b) => b.time === backtestStartTime);
        const from = startIdx >= 0 ? Math.max(0, startIdx - 5) : 0;
        setAllRange({ from: from as Logical, to: (bars.length - 1) as Logical });
      } else {
        const defaultVisible = pd === 'daily' || pd === 'weekly' ? 100 : 120;
        const from = Math.max(0, bars.length - defaultVisible);
        setAllRange({ from: from as Logical, to: (bars.length - 1) as Logical });
      }
    }

    if (alignWidthRafRef.current !== null) cancelAnimationFrame(alignWidthRafRef.current);
    alignWidthRafRef.current = requestAnimationFrame(() => {
      alignWidthRafRef.current = null;
      // 图表可能在下一帧前被销毁/重建（initCharts 或卸载），需重新读取当前实例
      const liveCharts: IChartApi[] = [mainChartRef.current, volumeChartRef.current, macdChartRef.current]
        .concat(rsiChartRef.current ?? [], ljjChartRef.current ?? [])
        .filter((c): c is IChartApi => c != null);
      // 若实例已被替换（首个不再是当时捕获的主图），说明本次对齐已过期
      if (liveCharts.length === 0 || liveCharts[0] !== activeCharts[0]) return;
      const maxWidth = Math.max(...liveCharts.map((c) => c.priceScale('right').width()));
      if (maxWidth > 0) {
        liveCharts.forEach((c) => c.applyOptions({ rightPriceScale: { minimumWidth: maxWidth } }));
      }
    });
  }, []);

  const loadData = useCallback(
    async (mkt: 'A' | 'HK', cd: string, pd: KlinePeriod, preserveViewport = false) => {
      if (!preserveViewport) setLoading(true);
      try {
        const res = await klineApi.get(mkt, cd, pd);
        if (res.data.length === 0) {
          applyData([], pd, preserveViewport);
          if (!preserveViewport) void message.warning(`${PERIOD_LABELS[pd]}暂无数据`);
        } else {
          applyData(res.data, pd, preserveViewport);
        }
      } catch (e) {
        console.error('Failed to load kline data', e);
        if (!preserveViewport) applyData([], pd);
      } finally {
        if (!preserveViewport) setLoading(false);
      }
    },
    [applyData],
  );

  useEffect(() => {
    zoomStorageKeyRef.current = zoomStorageKey;
  }, [zoomStorageKey]);

  // 回测预览：时间区间变化时更新 ref，并在拉取模式下就地重新取景（不重新拉取数据）
  useEffect(() => {
    viewStartDateRef.current = viewStartDate;
    viewEndDateRef.current = viewEndDate;
    if (!initialData && barsRef.current.length > 0 && periodRef.current !== 'timeshare') {
      applyData(barsRef.current, periodRef.current, false);
    }
  }, [viewStartDate, viewEndDate, initialData, applyData]);

  // 受控周期变化时同步内部 period（仅拉取模式，由父组件如回测页驱动）
  useEffect(() => {
    if (controlledPeriod) setPeriod(controlledPeriod);
  }, [controlledPeriod]);

  // 切换主图叠加内容（均线/BOLL）时，用当前数据就地重绘（保持视口），无需重新拉取
  useEffect(() => {
    overlayRef.current = overlay;
    if (barsRef.current.length > 0 && periodRef.current !== 'timeshare') {
      applyData(barsRef.current, periodRef.current, true);
    }
  }, [overlay, applyData]);

  const toggleOverlay = useCallback(() => {
    setOverlay((prev) => {
      const next: MainOverlay = prev === 'ma' ? 'boll' : 'ma';
      try {
        localStorage.setItem(OVERLAY_STORAGE_KEY, next);
      } catch {
        /* localStorage unavailable */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    initCharts();
  }, [initCharts]);

  useEffect(() => {
    if (!code) return;

    if (initialData) {
      applyData(initialData.data, period, false, initialData.backtestStartTime ?? undefined);
      // Don't auto-refresh for initial data
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      void loadData(market, code, period);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (isInTradingHours(market)) {
          void loadData(market, code, period, true);
        }
      }, 30000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [market, code, period, loadData, initialData, applyData]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (alignWidthRafRef.current !== null) {
        cancelAnimationFrame(alignWidthRafRef.current);
        alignWidthRafRef.current = null;
      }
      [mainChartRef, volumeChartRef, macdChartRef, rsiChartRef, ljjChartRef].forEach((ref) => {
        ref.current?.remove();
        ref.current = null;
      });
    };
  }, []);

  const tabItems = PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p] }));

  return (
    <div className={styles.wrapper}>
      {showPeriodTabs && (
        <Tabs
          activeKey={period}
          onChange={(k) => setPeriod(k as KlinePeriod)}
          items={tabItems}
          size="small"
          className={styles.tabs}
        />
      )}
      <Spin spinning={loading}>
        <div className={styles.subWrapper}>
          <div ref={mainLegendRef} className={styles.subLegend} />
          {period !== 'timeshare' && (
            <button type="button" className={styles.overlayToggle} onClick={toggleOverlay}>
              {overlay === 'boll' ? 'BOLL' : '均线'}
            </button>
          )}
          <div ref={containerRef} className={styles.main} />
        </div>
        <div className={styles.subWrapper}>
          <div ref={volLegendRef} className={styles.subLegend}>VOL: --</div>
          <div ref={volumeRef} className={styles.sub} />
        </div>
        <div className={styles.subWrapper}>
          <div ref={macdLegendRef} className={styles.subLegend}>DIF: --&nbsp;&nbsp;DEA: --&nbsp;&nbsp;MACD: --</div>
          <div ref={macdRef} className={styles.sub} />
        </div>
        {showRsi && (
          <div className={styles.subWrapper}>
            <div ref={rsiLegendRef} className={styles.subLegend}>RSI6: --</div>
            <div ref={rsiRef} className={styles.sub} />
          </div>
        )}
        {showLjj && (
          <div className={styles.subWrapper}>
            <div ref={ljjLegendRef} className={styles.subLegend}>ljj&nbsp;&nbsp;KMACD: --&nbsp;&nbsp;KRSI: --&nbsp;&nbsp;KMA: --</div>
            <div ref={ljjRef} className={styles.sub} />
          </div>
        )}
      </Spin>
    </div>
  );
}
