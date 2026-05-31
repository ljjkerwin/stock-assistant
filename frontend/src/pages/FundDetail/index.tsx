import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Typography, Descriptions, Spin, Tag, Button, Tooltip } from 'antd';
import { StarOutlined, StarFilled } from '@ant-design/icons';
import { fundApi } from '../../api/stock';
import NavChart from '../../components/NavChart';
import { useFavoritesStore } from '../../store/favoritesStore';
import type { FundInfo, FundHoldingPeriod } from '../../types';
import styles from './FundDetail.module.css';

export default function FundDetail() {
  const { code } = useParams<{ code: string }>();
  const [info, setInfo] = useState<FundInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [holdings, setHoldings] = useState<FundHoldingPeriod[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const { favorites, addStock, removeStock } = useFavoritesStore();
  const favoriteEntry = favorites.find((f) => f.market === 'FUND' && f.code === code);
  const isFavorited = !!favoriteEntry;

  useEffect(() => {
    if (!code) return;
    setInfo(null);
    setLoading(true);
    fundApi
      .getInfo(code)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [code]);

  useEffect(() => {
    if (!code) return;
    setHoldings([]);
    setHoldingsLoading(true);
    fundApi
      .getHoldings(code)
      .then(setHoldings)
      .catch(() => setHoldings([]))
      .finally(() => setHoldingsLoading(false));
  }, [code]);

  const maxHoldingLen = Math.max(...holdings.map((p) => p.holdings.length), 0);
  const parsedFundSize = info?.fundSize ? parseFloat(info.fundSize) : null;

  const prevCodes =
    holdings.length >= 2
      ? new Set(holdings[1].holdings.map((h) => h.code))
      : new Set<string>();

  const dailyUp = info?.dailyChangePct != null && info.dailyChangePct > 0;
  const dailyDown = info?.dailyChangePct != null && info.dailyChangePct < 0;
  const dailyColor = dailyUp ? '#ef5350' : dailyDown ? '#26a69a' : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {info?.name ?? code}
        </Typography.Title>
        <Tag color="purple" style={{ marginLeft: 8 }}>
          {code} · 基金
        </Tag>
        <span style={{ flex: 1 }} />
        {code && (
          <Tooltip title={isFavorited ? '取消收藏' : '添加收藏'}>
            <Button
              type="text"
              icon={isFavorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              onClick={() => {
                if (isFavorited) {
                  removeStock(favoriteEntry!.id!);
                } else {
                  addStock({ code, market: 'FUND', name: info?.name ?? code });
                }
              }}
            />
          </Tooltip>
        )}
      </div>

      <Spin spinning={loading}>
        {info && (
          <Descriptions size="small" column={4} className={styles.info}>
            <Descriptions.Item label="单位净值">
              <span style={{ fontWeight: 600 }}>
                {info.nav != null ? info.nav.toFixed(4) : '-'}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="累计净值">
              {info.accNav != null ? info.accNav.toFixed(4) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="日涨跌幅">
              <span style={{ color: dailyColor }}>
                {info.dailyChangePct != null
                  ? `${dailyUp ? '+' : ''}${info.dailyChangePct.toFixed(2)}%`
                  : '-'}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="净值日期">
              {info.navDate ?? '-'}
            </Descriptions.Item>
            {info.establishDate != null && (
              <Descriptions.Item label="成立日期">
                {info.establishDate}
              </Descriptions.Item>
            )}
            {info.fundSize != null && (
              <Descriptions.Item label="基金规模">
                {info.fundSize}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Spin>

      <div className={styles.chart}>
        {code && <NavChart code={code} />}
      </div>

      <Spin spinning={holdingsLoading}>
        {holdings.length > 0 && (
          <div className={styles.holdings}>
            <Typography.Text className={styles.holdingsTitle}>前10大持仓股</Typography.Text>
            <div className={styles.holdingsPeriods}>
              {holdings.map((p, periodIndex) => (
                <div key={p.period} className={styles.holdingsPeriod}>
                  <div className={styles.periodHeader}>
                    <span>{p.period}</span>
                    <span className={styles.periodDate}>截至 {p.endDate}</span>
                  </div>
                  <div className={styles.holdingsList}>
                    {Array.from({ length: maxHoldingLen }, (_, i) => p.holdings[i] ?? null).map((h, i) => {
                      if (!h) return <div key={i} className={styles.holdingItemEmpty} />;
                      const isNew = periodIndex === 0 && holdings.length >= 2 && !prevCodes.has(h.code);
                      return (
                        <div key={h.rank} className={styles.holdingItem}>
                          <span className={styles.holdingRank}>{h.rank}</span>
                          <span className={`${styles.holdingName}${isNew ? ` ${styles.holdingNameNew}` : ''}`}>
                            {h.name}
                            <span className={styles.holdingCode}>（{h.code}）</span>
                          </span>
                          <div className={styles.holdingRight}>
                            <span className={styles.holdingRatio}>
                              {h.marketValue != null ? `${h.marketValue.toFixed(2)}%` : '-'}
                            </span>
                            {parsedFundSize != null && h.marketValue != null && (
                              <span className={styles.holdingMv}>
                                {(parsedFundSize * h.marketValue / 100).toFixed(2)}亿
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Spin>
    </div>
  );
}
