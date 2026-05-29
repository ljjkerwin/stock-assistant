import { useEffect, useRef, useCallback, useState } from 'react';
import { Tabs, Spin, message } from 'antd';
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

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const navSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const accNavSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
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
        `<span>累计净值: ${bar.accNav.toFixed(4)}</span>&nbsp;&nbsp;` +
        `<span style="color:${pctColor}">日涨跌: ${pct}</span>`;
    });
  }, []);

  const applyData = useCallback((points: FundNavPoint[]) => {
    if (!chartRef.current) return;
    barsRef.current = points;

    if (navSeriesRef.current) {
      chartRef.current.removeSeries(navSeriesRef.current);
      navSeriesRef.current = null;
    }
    if (accNavSeriesRef.current) {
      chartRef.current.removeSeries(accNavSeriesRef.current);
      accNavSeriesRef.current = null;
    }

    const navSeries = chartRef.current.addSeries(LineSeries, {
      color: '#1677ff',
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      title: '单位净值',
    });
    navSeries.setData(
      points.map((p) => ({ time: p.date as Time, value: p.nav } as LineData)),
    );
    navSeriesRef.current = navSeries;

    const accNavSeries = chartRef.current.addSeries(LineSeries, {
      color: '#ff9800',
      lineWidth: 1,
      lastValueVisible: true,
      priceLineVisible: false,
      title: '累计净值',
    });
    accNavSeries.setData(
      points.map((p) => ({ time: p.date as Time, value: p.accNav } as LineData)),
    );
    accNavSeriesRef.current = accNavSeries;

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

  return (
    <div className={styles.wrapper}>
      <Tabs
        activeKey={period}
        onChange={(k) => setPeriod(k as FundNavPeriod)}
        items={tabItems}
        size="small"
        className={styles.tabs}
      />
      <Spin spinning={loading}>
        <div ref={legendRef} className={styles.legend} />
        <div ref={containerRef} className={styles.chart} />
      </Spin>
    </div>
  );
}
