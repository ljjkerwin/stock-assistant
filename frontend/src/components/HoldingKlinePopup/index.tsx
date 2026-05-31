import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spin } from 'antd';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';
import type { IChartApi, CandlestickData, LineData } from 'lightweight-charts';
import { klineApi } from '../../api/stock';
import styles from './HoldingKlinePopup.module.css';

interface Props {
  code: string;
  name: string;
  endDate?: string;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const POPUP_WIDTH = 460;
const CHART_HEIGHT = 220;
const HEADER_HEIGHT = 34;
const POPUP_HEIGHT = CHART_HEIGHT + HEADER_HEIGHT;

function nineMonthsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 9);
  return d.toISOString().split('T')[0];
}

function calcPosition(rect: DOMRect): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;

  let left = rect.right + 12;
  let top = rect.top + rect.height / 2 - POPUP_HEIGHT / 2;

  if (left + POPUP_WIDTH > vw - margin) {
    left = rect.left - POPUP_WIDTH - 12;
  }
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  if (top + POPUP_HEIGHT > vh - margin) {
    top = vh - POPUP_HEIGHT - margin;
  }
  return { left, top };
}

export default function HoldingKlinePopup({ code, name, endDate, anchorRect, onMouseEnter, onMouseLeave }: Props) {
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { left, top } = calcPosition(anchorRect);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const chart = createChart(containerRef.current, {
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
      height: CHART_HEIGHT,
    });
    chartRef.current = chart;

    const cutoff = nineMonthsAgo();

    klineApi
      .get('A', code, 'daily')
      .then((res) => {
        if (cancelled) return;
        const bars = res.data.filter((b) => b.time >= cutoff);
        if (bars.length === 0) return;

        const dates = bars.map((b) => b.time.split(' ')[0]);

        const candleSeries = chart.addSeries(CandlestickSeries, {
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
          dates.map((d, i) => ({
            time: d,
            open: bars[i].open,
            high: bars[i].high,
            low: bars[i].low,
            close: bars[i].close,
          } as CandlestickData)),
        );

        // Mark the K-line bar nearest to and no later than the holding report endDate
        if (endDate) {
          const markerDate = dates.filter((d) => d <= endDate).at(-1);
          if (markerDate) {
            createSeriesMarkers(candleSeries, [
              {
                time: markerDate,
                position: 'aboveBar',
                shape: 'arrowDown',
                color: '#FF6B35',
                text: '持仓日',
              },
            ]);
          }
        }

        const ma5 = chart.addSeries(LineSeries, {
          color: '#FFAB00',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        ma5.setData(
          bars
            .filter((b) => b.ma.ma5 != null)
            .map((b) => ({ time: b.time.split(' ')[0], value: b.ma.ma5! } as LineData)),
        );

        const ma20 = chart.addSeries(LineSeries, {
          color: '#1677FF',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        ma20.setData(
          bars
            .filter((b) => b.ma.ma20 != null)
            .map((b) => ({ time: b.time.split(' ')[0], value: b.ma.ma20! } as LineData)),
        );

        chart.timeScale().fitContent();
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      chart.remove();
      chartRef.current = null;
    };
  }, [code, endDate]);

  return createPortal(
    <div
      className={styles.popup}
      style={{ left, top, width: POPUP_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.header}>
        <span className={styles.title}>{name}</span>
        <span className={styles.meta}>{code} · 近9个月日K</span>
      </div>
      <div className={styles.chartWrap}>
        <Spin spinning={loading} style={{ minHeight: CHART_HEIGHT }}>
          <div ref={containerRef} />
        </Spin>
      </div>
    </div>,
    document.body,
  );
}
