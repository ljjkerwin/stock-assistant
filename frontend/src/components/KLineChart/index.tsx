import { useEffect, useRef, useCallback, useState } from 'react';
import { Tabs, Spin, message } from 'antd';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
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
  Time,
} from 'lightweight-charts';
import { klineApi } from '../../api/stock';
import type { KlinePeriod, KlineBar } from '../../types';
import { PERIOD_LABELS } from '../../types';
import styles from './KLineChart.module.css';

interface Props {
  market: 'A' | 'HK';
  code: string;
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

export default function KLineChart({ market, code }: Props) {
  const [period, setPeriod] = useState<KlinePeriod>('timeshare');
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);

  const mainChartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const difSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const deaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdBarSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma10SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncingRef = useRef(false);

  // Data refs — used by legend updater to look up values by time
  const barsRef = useRef<KlineBar[]>([]);
  const chartTimesRef = useRef<(number | string)[]>([]);
  const periodRef = useRef<KlinePeriod>('timeshare');

  // Legend DOM refs
  const mainLegendRef = useRef<HTMLDivElement>(null);
  const volLegendRef = useRef<HTMLDivElement>(null);
  const macdLegendRef = useRef<HTMLDivElement>(null);

  const initCharts = useCallback(() => {
    if (!containerRef.current || !volumeRef.current || !macdRef.current) return;

    [mainChartRef, volumeChartRef, macdChartRef].forEach((ref) => {
      ref.current?.remove();
      ref.current = null;
    });

    const noTimeScale = { timeScale: { ...CHART_OPTIONS.timeScale, visible: false } };
    const mainChart = createChart(containerRef.current, { ...CHART_OPTIONS, height: 300 });
    mainChartRef.current = mainChart;

    const volumeChart = createChart(volumeRef.current, { ...CHART_OPTIONS, ...noTimeScale, height: 100 });
    volumeChartRef.current = volumeChart;

    const macdChart = createChart(macdRef.current, { ...CHART_OPTIONS, ...noTimeScale, height: 100 });
    macdChartRef.current = macdChart;

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
          const m = bar.ma;
          const maHtml = m
            ? `&nbsp;&nbsp;<span style="color:#FFAB00">MA5:${m.ma5?.toFixed(3) ?? '--'}</span>&nbsp;&nbsp;` +
              `<span style="color:#E91E63">MA10:${m.ma10?.toFixed(3) ?? '--'}</span>&nbsp;&nbsp;` +
              `<span style="color:#1677FF">MA20:${m.ma20?.toFixed(3) ?? '--'}</span>&nbsp;&nbsp;` +
              `<span style="color:#9C27B0">MA60:${m.ma60?.toFixed(3) ?? '--'}</span>`
            : '';
          mainLegendRef.current.innerHTML =
            `<span>开:${bar.open.toFixed(3)}</span>&nbsp;&nbsp;` +
            `<span>高:${bar.high.toFixed(3)}</span>&nbsp;&nbsp;` +
            `<span>低:${bar.low.toFixed(3)}</span>&nbsp;&nbsp;` +
            `<span>收:${bar.close.toFixed(3)}</span>` +
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
    }

    mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) {
        volumeChart.timeScale().setVisibleLogicalRange(range);
        macdChart.timeScale().setVisibleLogicalRange(range);
      }
    });
    volumeChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) {
        mainChart.timeScale().setVisibleLogicalRange(range);
        macdChart.timeScale().setVisibleLogicalRange(range);
      }
    });
    macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) {
        mainChart.timeScale().setVisibleLogicalRange(range);
        volumeChart.timeScale().setVisibleLogicalRange(range);
      }
    });

    mainChart.subscribeCrosshairMove((param) => {
      if (param.time) updateAllLegends(param.time);
      if (syncingRef.current) return;
      syncingRef.current = true;
      if (param.time) {
        if (volumeSeriesRef.current) volumeChart.setCrosshairPosition(0, param.time, volumeSeriesRef.current);
        if (difSeriesRef.current) macdChart.setCrosshairPosition(0, param.time, difSeriesRef.current);
      } else {
        volumeChart.clearCrosshairPosition();
        macdChart.clearCrosshairPosition();
      }
      syncingRef.current = false;
    });

    volumeChart.subscribeCrosshairMove((param) => {
      if (param.time) updateAllLegends(param.time);
      if (syncingRef.current) return;
      syncingRef.current = true;
      if (param.time) {
        if (mainSeriesRef.current) mainChart.setCrosshairPosition(0, param.time, mainSeriesRef.current);
        if (difSeriesRef.current) macdChart.setCrosshairPosition(0, param.time, difSeriesRef.current);
      } else {
        mainChart.clearCrosshairPosition();
        macdChart.clearCrosshairPosition();
      }
      syncingRef.current = false;
    });

    macdChart.subscribeCrosshairMove((param) => {
      if (param.time) updateAllLegends(param.time);
      if (syncingRef.current) return;
      syncingRef.current = true;
      if (param.time) {
        if (mainSeriesRef.current) mainChart.setCrosshairPosition(0, param.time, mainSeriesRef.current);
        if (volumeSeriesRef.current) volumeChart.setCrosshairPosition(0, param.time, volumeSeriesRef.current);
      } else {
        mainChart.clearCrosshairPosition();
        volumeChart.clearCrosshairPosition();
      }
      syncingRef.current = false;
    });
  }, []);

  const applyData = useCallback((bars: KlineBar[], pd: KlinePeriod) => {
    if (!mainChartRef.current || !volumeChartRef.current || !macdChartRef.current) return;

    const isTimeshare = pd === 'timeshare';
    const interactionOpts = isTimeshare
      ? { handleScale: false, handleScroll: false }
      : { handleScale: true, handleScroll: true };
    [mainChartRef.current, volumeChartRef.current, macdChartRef.current].forEach((c) =>
      c?.applyOptions(interactionOpts),
    );

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
    [ma5SeriesRef, ma10SeriesRef, ma20SeriesRef, ma60SeriesRef].forEach((ref) => {
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

    if (isTimeshare || bars.length === 0) {
      mainChartRef.current.timeScale().fitContent();
      volumeChartRef.current.timeScale().fitContent();
      macdChartRef.current.timeScale().fitContent();
    } else {
      const defaultVisible = pd === 'daily' || pd === 'weekly' ? 100 : 120;
      const from = Math.max(0, bars.length - defaultVisible);
      const range = { from, to: bars.length - 1 };
      mainChartRef.current.timeScale().setVisibleLogicalRange(range);
      volumeChartRef.current.timeScale().setVisibleLogicalRange(range);
      macdChartRef.current.timeScale().setVisibleLogicalRange(range);
    }

    requestAnimationFrame(() => {
      const charts = [mainChartRef.current, volumeChartRef.current, macdChartRef.current];
      const maxWidth = Math.max(...charts.map((c) => c?.priceScale('right').width() ?? 0));
      if (maxWidth > 0) {
        charts.forEach((c) => c?.applyOptions({ rightPriceScale: { minimumWidth: maxWidth } }));
      }
    });
  }, []);

  const loadData = useCallback(
    async (mkt: 'A' | 'HK', cd: string, pd: KlinePeriod) => {
      setLoading(true);
      try {
        const res = await klineApi.get(mkt, cd, pd);
        if (res.data.length === 0) {
          applyData([], pd);
          void message.warning(`${PERIOD_LABELS[pd]}暂无数据`);
        } else {
          applyData(res.data, pd);
        }
      } catch (e) {
        console.error('Failed to load kline data', e);
        applyData([], pd);
      } finally {
        setLoading(false);
      }
    },
    [applyData],
  );

  useEffect(() => {
    initCharts();
  }, [initCharts]);

  useEffect(() => {
    if (!code) return;
    void loadData(market, code, period);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (isInTradingHours(market)) {
        void loadData(market, code, period);
      }
    }, 30000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [market, code, period, loadData]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      [mainChartRef, volumeChartRef, macdChartRef].forEach((ref) => {
        ref.current?.remove();
        ref.current = null;
      });
    };
  }, []);

  const tabItems = PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p] }));

  return (
    <div className={styles.wrapper}>
      <Tabs
        activeKey={period}
        onChange={(k) => setPeriod(k as KlinePeriod)}
        items={tabItems}
        size="small"
        className={styles.tabs}
      />
      <Spin spinning={loading}>
        <div className={styles.subWrapper}>
          <div ref={mainLegendRef} className={styles.subLegend} />
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
      </Spin>
    </div>
  );
}
