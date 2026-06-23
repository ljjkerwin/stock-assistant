import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Descriptions, Spin, Tag, Button, Tooltip } from 'antd';
import { StarOutlined, StarFilled, LineChartOutlined } from '@ant-design/icons';
import { stocksApi } from '../../api/stock';
import KLineChart from '../../components/KLineChart';
import StockMonitorButton from '../../components/StockMonitorButton';
import AddToListMenu from '../../components/AddToListMenu';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import type { StockInfo } from '../../types';
import styles from './StockDetail.module.css';

function formatNumber(n: number | null, digits = 2): string {
  if (n == null) return '-';
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
  return n.toFixed(digits);
}

export default function StockDetail() {
  const { market, code } = useParams<{ market: string; code: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<StockInfo | null>(null);
  const [loading, setLoading] = useState(false);
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
          <Descriptions size="small" column={5} className={styles.info}>
            <Descriptions.Item label="现价">
              <span style={{ color: isUp ? '#ef5350' : isDown ? '#26a69a' : undefined, fontWeight: 600 }}>
                {info.price != null ? info.price.toFixed(2) : '-'}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="涨跌幅">
              <span style={{ color: isUp ? '#ef5350' : isDown ? '#26a69a' : undefined }}>
                {info.change_pct != null
                  ? `${isUp ? '+' : ''}${info.change_pct.toFixed(2)}%`
                  : '-'}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="成交额">
              {formatNumber(info.turnover)}
            </Descriptions.Item>
            <Descriptions.Item label="市值">
              {formatNumber(info.market_cap)}
            </Descriptions.Item>
            <Descriptions.Item label="PE">
              {info.pe != null ? info.pe.toFixed(2) : '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Spin>

      <div className={styles.chart}>
        {market && code && <KLineChart market={market as 'A' | 'HK'} code={code} />}
      </div>
    </div>
  );
}
