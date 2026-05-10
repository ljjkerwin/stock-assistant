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

const CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: '#ffffff' },
    textColor: '#333',
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initCharts = useCallback(() => {
    if (!containerRef.current || !volumeRef.current || !macdRef.current) return;

    [mainChartRef, volumeChartRef, macdChartRef].forEach((ref) => {
      ref.current?.remove();
      ref.current = null;
    });

    const mainChart = createChart(containerRef.current, { ...CHART_OPTIONS, height: 300 });
    mainChartRef.current = mainChart;

    const volumeChart = createChart(volumeRef.current, { ...CHART_OPTIONS, height: 100 });
    volumeChartRef.current = volumeChart;

    const macdChart = createChart(macdRef.current, { ...CHART_OPTIONS, height: 100 });
    macdChartRef.current = macdChart;

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

    if (mainSeriesRef.current) {
      mainChartRef.current.removeSeries(mainSeriesRef.current);
      mainSeriesRef.current = null;
    }
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
      const lineSeries = mainChartRef.current.addSeries(LineSeries, { color: '#1677ff', lineWidth: 1 });
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
      });
      candleSeries.setData(
        bars.map(
          (b) =>
            ({ time: toChartTime(b.time), open: b.open, high: b.high, low: b.low, close: b.close } as CandlestickData),
        ),
      );
      mainSeriesRef.current = candleSeries;
    }

    const volSeries = volumeChartRef.current.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
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

    const difSeries = macdChartRef.current.addSeries(LineSeries, { color: '#1677ff', lineWidth: 1 });
    difSeries.setData(bars.map((b) => ({ time: toChartTime(b.time), value: b.macd.dif } as LineData)));
    difSeriesRef.current = difSeries;

    const deaSeries = macdChartRef.current.addSeries(LineSeries, { color: '#ff9800', lineWidth: 1 });
    deaSeries.setData(bars.map((b) => ({ time: toChartTime(b.time), value: b.macd.dea } as LineData)));
    deaSeriesRef.current = deaSeries;

    const macdBarSeries = macdChartRef.current.addSeries(HistogramSeries, { priceScaleId: 'right' });
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
        <div ref={containerRef} className={styles.main} />
        <div ref={volumeRef} className={styles.sub} />
        <div ref={macdRef} className={styles.sub} />
      </Spin>
    </div>
  );
}
