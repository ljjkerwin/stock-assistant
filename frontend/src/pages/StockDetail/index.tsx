import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Spin, Tag, Button, Tooltip } from 'antd';
import { StarOutlined, StarFilled, LineChartOutlined } from '@ant-design/icons';
import { stocksApi, darktradeApi } from '../../api/stock';
import KLineChart from '../../components/KLineChart';
import StockMonitorButton from '../../components/StockMonitorButton';
import AddToListMenu from '../../components/AddToListMenu';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import type { StockInfo, DarkTradeSnapshot } from '../../types';
import styles from './StockDetail.module.css';

function formatNumber(n: number | null, digits = 2): string {
  if (n == null) return '-';
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
  return n.toFixed(digits);
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

export default function StockDetail() {
  const { market, code } = useParams<{ market: string; code: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<StockInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [dtSnapshots, setDtSnapshots] = useState<DarkTradeSnapshot[]>([]);
  const [klineDate, setKlineDate] = useState<string | null>(null);
  const { itemsByList, fetchList, addToList, removeItem } = useFavoritesStore();
  const { stockLists, fetchLists } = useWatchListStore();
  const defaultListId = stockLists.find((l) => l.isDefault)?.id ?? null;
  const favoriteEntry =
    defaultListId != null
      ? (itemsByList[defaultListId] ?? []).find((f) => f.market === market && f.code === code)
      : undefined;
  const isFavorited = !!favoriteEntry;

  useEffect(() => {
    fetchLists('stock');
  }, [fetchLists]);

  useEffect(() => {
    if (defaultListId != null) fetchList(defaultListId);
  }, [defaultListId, fetchList]);

  useEffect(() => {
    if (!market || !code) return;
    setInfo(null);
    setLoading(true);
    stocksApi
      .getInfo(market as 'A' | 'HK', code)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [market, code]);

  // 切换股票时重置快照，等待新数据加载
  useEffect(() => {
    setDtSnapshots([]);
  }, [market, code]);

  // 按 K 线实际交易日拉取当日分钟粒度暗盘快照（与分时图同一交易日）
  // 交易时间内每 30 秒轮询，确保暗盘快照数据实时更新且副图能动态画线与查询最新 legend
  useEffect(() => {
    if (market !== 'A' || !code || !klineDate) return;

    const fetchSnapshots = () => {
      darktradeApi
        .getSnapshotsBatch([code], klineDate)
        .then((map) => setDtSnapshots(map[code] ?? []))
        .catch(() => { });
    };

    fetchSnapshots();

    const timer = setInterval(() => {
      if (isInTradingHours(market as 'A' | 'HK')) {
        fetchSnapshots();
      }
    }, 30000);

    return () => clearInterval(timer);
  }, [market, code, klineDate]);

  const isUp = info?.change_pct != null && info.change_pct > 0;
  const isDown = info?.change_pct != null && info.change_pct < 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {info?.name ?? code}
        </Typography.Title>
        <Tag color="blue" style={{ marginLeft: 8 }}>
          {code} · {market === 'HK' ? '港股' : 'A股'}
        </Tag>
        <span style={{ flex: 1 }} />
        {market && code && (
          <Tooltip title={isFavorited ? '取消收藏' : '添加收藏'}>
            <Button
              type="text"
              icon={isFavorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              onClick={() => {
                if (isFavorited) {
                  removeItem(favoriteEntry!.id!, defaultListId!);
                } else if (defaultListId != null) {
                  addToList(defaultListId, { code, market: market as 'A' | 'HK', name: info?.name ?? code });
                }
              }}
            />
          </Tooltip>
        )}
        {market && code && (
          <AddToListMenu
            boardType="stock"
            stock={{ code, market: market as 'A' | 'HK', name: info?.name ?? code }}
          />
        )}
        {market && code && (
          <>
            <Tooltip title="策略回测">
              <Button
                type="text"
                icon={<LineChartOutlined />}
                onClick={() => navigate(`/strategy-backtest/${code}`)}
              />
            </Tooltip>
            <StockMonitorButton
              market={market as 'A' | 'HK'}
              code={code}
              stockName={info?.name ?? code ?? ''}
            />
          </>
        )}
      </div>

      <Spin spinning={loading}>
        {info && (
          <div className={styles.info}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>现价</span>
              <span style={{ color: isUp ? '#ef5350' : isDown ? '#26a69a' : undefined, fontWeight: 600 }}>
                {info.price != null ? info.price.toFixed(2) : '-'}
              </span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>涨跌幅</span>
              <span style={{ color: isUp ? '#ef5350' : isDown ? '#26a69a' : undefined }}>
                {info.change_pct != null
                  ? `${isUp ? '+' : ''}${info.change_pct.toFixed(2)}%`
                  : '-'}
              </span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>成交额</span>
              <span>{formatNumber(info.turnover)}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>市值</span>
              <span>{formatNumber(info.market_cap)}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>PE</span>
              <span>{info.pe != null ? info.pe.toFixed(2) : '-'}</span>
            </div>
          </div>
        )}
      </Spin>

      <div className={styles.chart}>
        {market && code && (
          <KLineChart
            market={market as 'A' | 'HK'}
            code={code}
            showDarkTrade={market === 'A'}
            darkTradeSnapshots={dtSnapshots}
            onDateResolved={setKlineDate}
          />
        )}
      </div>
    </div>
  );
}
