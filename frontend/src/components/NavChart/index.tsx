import { useEffect, useRef, useCallback, useState } from 'react';
import { Tabs, Spin, Tooltip, message } from 'antd';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';
import { fundApi } from '../../api/stock';
import type { FundNavPeriod, FundNavPoint } from '../../types';
import { FUND_PERIOD_LABELS, FUND_PERIOD_LIMITS } from '../../types';
import styles from './NavChart.module.css';

const ANNUAL_RF_RATE = 0.025;

function calcSharpe(points: FundNavPoint[]): number | null {
  const returns = points
    .map((p) => p.changePct)
    .filter((r): r is number => r != null)
    .map((r) => r / 100);

  if (returns.length < 2) return null;

  const dailyRf = ANNUAL_RF_RATE / 252;
  const excess = returns.map((r) => r - dailyRf);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((a, b) => a + (b - mean) ** 2, 0) / (excess.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return null;
  return (mean / std) * Math.sqrt(252);
}

function calcPeriodReturn(points: FundNavPoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].nav;
  const last = points[points.length - 1].nav;
  if (first <= 0) return null;
  return (last - first) / first;
}

function calcMaxDrawdown(points: FundNavPoint[]): number | null {
  if (points.length < 2) return null;
  let peak = points[0].nav;
  let maxDD = 0;
  for (const p of points) {
    if (p.nav > peak) peak = p.nav;
    const dd = (p.nav - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

interface Props {
  code: string;
}

const PERIODS = Object.keys(FUND_PERIOD_LABELS) as FundNavPeriod[];

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
  timeScale: { borderColor: '#e0e0e0', fixRightEdge: true },
};

export default function NavChart({ code }: Props) {
  const [period, setPeriod] = useState<FundNavPeriod>('1Y');
  const [loading, setLoading] = useState(false);
  const [sharpe, setSharpe] = useState<number | null>(null);
  const [periodReturn, setPeriodReturn] = useState<number | null>(null);
  const [maxDrawdown, setMaxDrawdown] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const navSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<FundNavPoint[]>([]);

  const initChart = useCallback(() => {
    if (!containerRef.current) return;
    chartRef.current?.remove();
    chartRef.current = null;

    const chart = createChart(containerRef.current, { ...CHART_OPTIONS, height: 300 });
    chartRef.current = chart;

    chart.subscribeCrosshairMove((param) => {
      if (!legendRef.current) return;
      if (!param.time) {
        legendRef.current.textContent = '';
        return;
      }
      const idx = barsRef.current.findIndex((b) => b.date === (param.time as string));
      if (idx < 0) return;
      const bar = barsRef.current[idx];
      const pct = bar.changePct != null ? `${bar.changePct >= 0 ? '+' : ''}${bar.changePct.toFixed(2)}%` : '--';
      const pctColor = bar.changePct != null && bar.changePct > 0 ? '#ef5350' : bar.changePct != null && bar.changePct < 0 ? '#26a69a' : '#333';
      legendRef.current.innerHTML =
        `<span>${bar.date}</span>&nbsp;&nbsp;` +
        `<span>单位净值: ${bar.nav.toFixed(4)}</span>&nbsp;&nbsp;` +
        `<span style="color:${pctColor}">日涨跌: ${pct}</span>`;
    });
  }, []);

  const applyData = useCallback((points: FundNavPoint[]) => {
    if (!chartRef.current) return;
    barsRef.current = points;
    setSharpe(calcSharpe(points));
    setPeriodReturn(calcPeriodReturn(points));
    setMaxDrawdown(calcMaxDrawdown(points));

    if (navSeriesRef.current) {
      chartRef.current.removeSeries(navSeriesRef.current);
      navSeriesRef.current = null;
    }

    const navSeries = chartRef.current.addSeries(LineSeries, {
      color: '#1677ff',
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
    });
    navSeries.setData(
      points.map((p) => ({ time: p.date as Time, value: p.nav } as LineData)),
    );
    navSeriesRef.current = navSeries;

    chartRef.current.timeScale().fitContent();
  }, []);

  const loadData = useCallback(
    async (cd: string, pd: FundNavPeriod) => {
      setLoading(true);
      try {
        const res = await fundApi.getNav(cd, FUND_PERIOD_LIMITS[pd]);
        if (res.data.length === 0) {
          applyData([]);
          void message.warning('暂无净值数据');
        } else {
          applyData(res.data);
        }
      } catch {
        applyData([]);
      } finally {
        setLoading(false);
      }
    },
    [applyData],
  );

  useEffect(() => {
    initChart();
  }, [initChart]);

  useEffect(() => {
    if (!code) return;
    void loadData(code, period);
  }, [code, period, loadData]);

  useEffect(() => {
    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, []);

  const tabItems = PERIODS.map((p) => ({ key: p, label: FUND_PERIOD_LABELS[p] }));

  const sharpeColor =
    sharpe == null ? '#999' : sharpe >= 1 ? '#52c41a' : sharpe >= 0 ? '#faad14' : '#ff4d4f';
  const returnColor =
    periodReturn == null ? '#999' : periodReturn > 0 ? '#ef5350' : periodReturn < 0 ? '#26a69a' : '#999';
  const returnStr =
    periodReturn != null
      ? `${periodReturn > 0 ? '+' : ''}${(periodReturn * 100).toFixed(2)}%`
      : '--';
  const drawdownStr = maxDrawdown != null ? `${(maxDrawdown * 100).toFixed(2)}%` : '--';
  const drawdownColor = maxDrawdown != null && maxDrawdown < 0 ? '#ff4d4f' : '#999';

  return (
    <div className={styles.wrapper}>
      <Tabs
        activeKey={period}
        onChange={(k) => setPeriod(k as FundNavPeriod)}
        items={tabItems}
        size="small"
        className={styles.tabs}
      />
      <div className={styles.statsRow}>
        <Tooltip title="区间涨幅，基于所选时间段首尾单位净值计算">
          <span className={styles.statItem}>
            区间涨幅：<strong style={{ color: returnColor }}>{returnStr}</strong>
          </span>
        </Tooltip>
        <span className={styles.statDivider} />
        <Tooltip title="区间最大回撤：从高点到低点的最大跌幅，反映最坏情况下的亏损幅度">
          <span className={styles.statItem}>
            最大回撤：<strong style={{ color: drawdownColor }}>{drawdownStr}</strong>
          </span>
        </Tooltip>
        <span className={styles.statDivider} />
        <Tooltip title="年化夏普比率（无风险利率 2.5%，基于区间日涨跌幅计算）。≥1 优秀，0~1 一般，<0 较差">
          <span className={styles.statItem}>
            夏普比率：<strong style={{ color: sharpeColor }}>{sharpe != null ? sharpe.toFixed(2) : '--'}</strong>
          </span>
        </Tooltip>
      </div>
      <Spin spinning={loading}>
        <div ref={legendRef} className={styles.legend} />
        <div ref={containerRef} className={styles.chart} />
      </Spin>
    </div>
  );
}
