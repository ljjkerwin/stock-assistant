import { useEffect, useState, useRef, useCallback } from 'react';
import { Radio, Empty, Spin, Button } from 'antd';
import type { LogicalRange } from 'lightweight-charts';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import type { DarkTradeSnapshot, KlinePeriod, StockInfo } from '../../types';
import { PERIOD_LABELS } from '../../types';
import { darktradeApi, stocksApi } from '../../api/stock';
import StockKlineCard, { type CardHandle, type OverlayMode } from './StockKlineCard';
import styles from './StockListKline.module.css';

type SubChart = 'volume' | 'macd' | 'rsi';

const SUB_CHART_OPTIONS: { key: SubChart; label: string }[] = [
  { key: 'volume', label: '成交量' },
  { key: 'macd', label: 'MACD' },
  { key: 'rsi', label: 'RSI' },
];

const PERIOD_OPTIONS: KlinePeriod[] = ['timeshare', '5min', '15min', '30min', '60min', 'daily', 'weekly'];

function loadPeriod(): KlinePeriod {
  try {
    const v = localStorage.getItem('stockListKline:period');
    if (v && (Object.keys(PERIOD_LABELS) as KlinePeriod[]).includes(v as KlinePeriod)) return v as KlinePeriod;
  } catch { /* ignore */ }
  return 'daily';
}

function loadOverlay(): OverlayMode {
  try {
    const v = localStorage.getItem('stockListKline:overlay');
    if (v === 'ma' || v === 'boll') return v;
  } catch { /* ignore */ }
  return 'ma';
}

function loadSubCharts(): SubChart[] {
  try {
    const v = localStorage.getItem('stockListKline:subCharts');
    if (v) {
      const arr = JSON.parse(v) as SubChart[];
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* ignore */ }
  return ['volume'];
}

function loadShowDarkTrade(): boolean {
  try { return localStorage.getItem('stockListKline:showDarkTrade') === 'true'; } catch { return false; }
}


export default function StockListKline() {
  const { itemsByList, fetchList } = useFavoritesStore();
  const { currentStockListId, stockLists, fetchLists } = useWatchListStore();
  const [period, setPeriod] = useState<KlinePeriod>(loadPeriod);
  const [overlay, setOverlay] = useState<OverlayMode>(loadOverlay);
  const [subCharts, setSubCharts] = useState<SubChart[]>(loadSubCharts);
  const [showDarkTrade, setShowDarkTrade] = useState<boolean>(loadShowDarkTrade);
  const [darkSnapshotMap, setDarkSnapshotMap] = useState<Record<string, DarkTradeSnapshot[]>>({});
  const [stockInfoMap, setStockInfoMap] = useState<Record<string, StockInfo>>({});
  const [klineDate, setKlineDate] = useState<string | null>(null);

  const cardRefs = useRef<Map<number, CardHandle>>(new Map());
  const syncRafRef = useRef<number | null>(null);

  const handleRangeChange = useCallback((sourceId: number, range: LogicalRange) => {
    if (syncRafRef.current !== null) cancelAnimationFrame(syncRafRef.current);
    syncRafRef.current = requestAnimationFrame(() => {
      syncRafRef.current = null;
      try {
        localStorage.setItem(`stockListKline:range:${period}`, JSON.stringify(range));
      } catch { /* ignore */ }
      cardRefs.current.forEach((handle, id) => {
        if (id !== sourceId) handle.setRange(range);
      });
    });
  }, [period]);

  const handlePeriodChange = (p: KlinePeriod) => {
    setPeriod(p);
    try { localStorage.setItem('stockListKline:period', p); } catch { /* ignore */ }
  };

  const handleOverlayChange = (o: OverlayMode) => {
    setOverlay(o);
    try { localStorage.setItem('stockListKline:overlay', o); } catch { /* ignore */ }
  };

  const handleSubChartToggle = (key: SubChart) => {
    setSubCharts((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem('stockListKline:subCharts', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const handleDarkTradeToggle = () => {
    setShowDarkTrade((prev) => {
      const next = !prev;
      try { localStorage.setItem('stockListKline:showDarkTrade', String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    fetchLists('stock');
  }, [fetchLists]);

  useEffect(() => {
    if (currentStockListId != null) fetchList(currentStockListId);
  }, [currentStockListId, fetchList]);

  // 列表切换时重置 klineDate，等待卡片重新上报
  useEffect(() => {
    setKlineDate(null);
  }, [currentStockListId]);

  const handleDateResolved = useCallback((date: string) => {
    setKlineDate((prev) => prev ?? date);
  }, []);

  const items = currentStockListId != null ? (itemsByList[currentStockListId] ?? []) : [];
  const listName = stockLists.find((l) => l.id === currentStockListId)?.name ?? '';
  const stockItems = items.filter((s) => s.market !== 'FUND');

  // 批量拉取/刷新标的的暗盘数据及快照，不再进行定时轮询
  useEffect(() => {
    if (stockItems.length === 0 || !klineDate) {
      setDarkSnapshotMap({});
      return;
    }
    const aCodes = stockItems.filter((s) => s.market === 'A').map((s) => s.code);

    const fetchData = () => {
      if (aCodes.length > 0) {
        darktradeApi.getSnapshotsBatch(aCodes, klineDate).then(setDarkSnapshotMap);
      } else {
        setDarkSnapshotMap({});
      }
    };

    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStockListId, itemsByList, klineDate]);

  const stockSymbolsStr = stockItems.map((s) => `${s.market}:${s.code}`).join(',');

  // 批量拉取个股基本行情（最新价、涨跌幅）
  useEffect(() => {
    if (!stockSymbolsStr) {
      setStockInfoMap({});
      return;
    }
    const symbols = stockSymbolsStr.split(',');
    stocksApi.getBatch(symbols).then(setStockInfoMap);
  }, [stockSymbolsStr]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.listName}>{listName}</span>
        <Radio.Group
          value={period}
          onChange={(e) => handlePeriodChange(e.target.value as KlinePeriod)}
          optionType="button"
          buttonStyle="solid"
          size="small"
        >
          {PERIOD_OPTIONS.map((p) => (
            <Radio.Button key={p} value={p}>{PERIOD_LABELS[p]}</Radio.Button>
          ))}
        </Radio.Group>

        {period !== 'timeshare' && (
          <>
            <div className={styles.toolbarSep} />
            <Radio.Group
              value={overlay}
              onChange={(e) => handleOverlayChange(e.target.value as OverlayMode)}
              optionType="button"
              buttonStyle="solid"
              size="small"
            >
              <Radio.Button value="ma">均线</Radio.Button>
              <Radio.Button value="boll">BOLL</Radio.Button>
            </Radio.Group>
          </>
        )}

        <div className={styles.toolbarSep} />

        <div className={styles.subChartGroup}>
          {SUB_CHART_OPTIONS.map(({ key, label }) => (
            <Button
              key={key}
              size="small"
              type={subCharts.includes(key) ? 'primary' : 'default'}
              onClick={() => handleSubChartToggle(key)}
            >
              {label}
            </Button>
          ))}
          <Button
            size="small"
            type={showDarkTrade ? 'primary' : 'default'}
            onClick={handleDarkTradeToggle}
          >
            暗盘
          </Button>
        </div>
      </div>

      {stockItems.length === 0 ? (
        <div className={styles.empty}>
          {currentStockListId == null ? (
            <Spin />
          ) : (
            <Empty description="当前列表没有股票标的" />
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {stockItems.map((stock) => (
            <div key={stock.id} className={styles.cardWrapper}>
              <StockKlineCard
                ref={(handle) => {
                  if (handle) cardRefs.current.set(stock.id!, handle);
                  else cardRefs.current.delete(stock.id!);
                }}
                code={stock.code}
                market={stock.market as 'A' | 'HK'}
                name={stock.name}
                period={period}
                overlay={overlay}
                showVolume={subCharts.includes('volume')}
                showMacd={subCharts.includes('macd')}
                showRsi={subCharts.includes('rsi')}
                showDarkTrade={showDarkTrade && stock.market === 'A' && period === 'timeshare'}
                darkTradeData={(() => {
                  const snaps = darkSnapshotMap[stock.code] || [];
                  return snaps.length > 0 ? snaps[snaps.length - 1] : null;
                })()}
                darkTradeSnapshots={darkSnapshotMap[stock.code]}
                stockInfo={stockInfoMap[`${stock.market}:${stock.code}`]}
                onRangeChange={(range) => handleRangeChange(stock.id!, range)}
                onDateResolved={handleDateResolved}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
