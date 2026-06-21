import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Typography, Descriptions, Spin, Tag, Button, Tooltip } from 'antd';
import { StarOutlined, StarFilled } from '@ant-design/icons';
import { fundApi } from '../../api/stock';
import NavChart from '../../components/NavChart';
import HoldingKlinePopup from '../../components/HoldingKlinePopup';
import AddToListMenu from '../../components/AddToListMenu';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import type { FundInfo, FundHoldingPeriod } from '../../types';
import styles from './FundDetail.module.css';

interface HoveredHolding {
  code: string;
  name: string;
  periodIndex: number;
  rect: DOMRect;
}

export default function FundDetail() {
  const { code } = useParams<{ code: string }>();
  const [info, setInfo] = useState<FundInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [holdings, setHoldings] = useState<FundHoldingPeriod[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [hoveredHolding, setHoveredHolding] = useState<HoveredHolding | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { itemsByList, fetchList, addToList, removeItem } = useFavoritesStore();
  const { fundLists, fetchLists } = useWatchListStore();
  const defaultListId = fundLists.find((l) => l.isDefault)?.id ?? null;
  const favoriteEntry =
    defaultListId != null
      ? (itemsByList[defaultListId] ?? []).find((f) => f.market === 'FUND' && f.code === code)
      : undefined;
  const isFavorited = !!favoriteEntry;

  useEffect(() => {
    fetchLists('fund');
  }, [fetchLists]);

  useEffect(() => {
    if (defaultListId != null) fetchList(defaultListId);
  }, [defaultListId, fetchList]);

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

  const prevCodesByPeriod = holdings.map((_, idx) =>
    idx + 1 < holdings.length
      ? new Set(holdings[idx + 1].holdings.map((h) => h.code))
      : null,
  );

  const dailyUp = info?.dailyChangePct != null && info.dailyChangePct > 0;
  const dailyDown = info?.dailyChangePct != null && info.dailyChangePct < 0;
  const dailyColor = dailyUp ? '#ef5350' : dailyDown ? '#26a69a' : undefined;

  const handleHoldingEnter = (hCode: string, hName: string, pIdx: number, e: React.MouseEvent) => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    setHoveredHolding({ code: hCode, name: hName, periodIndex: pIdx, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
  };

  const handleHoldingLeave = () => {
    leaveTimerRef.current = setTimeout(() => setHoveredHolding(null), 200);
  };

  const handlePopupEnter = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
  };

  const handlePopupLeave = () => {
    leaveTimerRef.current = setTimeout(() => setHoveredHolding(null), 200);
  };

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
                  removeItem(favoriteEntry!.id!, defaultListId!);
                } else if (defaultListId != null) {
                  addToList(defaultListId, { code, market: 'FUND', name: info?.name ?? code });
                }
              }}
            />
          </Tooltip>
        )}
        {code && <AddToListMenu boardType="fund" stock={{ code, market: 'FUND', name: info?.name ?? code }} />}
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
                      const isNew = prevCodesByPeriod[periodIndex] !== null && !prevCodesByPeriod[periodIndex]!.has(h.code);
                      return (
                        <div key={h.rank} className={styles.holdingItem}>
                          <span className={styles.holdingRank}>{h.rank}</span>
                          <span
                            className={`${styles.holdingName} ${styles.holdingNameHoverable}`}
                            onMouseEnter={(e) => handleHoldingEnter(h.code, h.name, periodIndex, e)}
                            onMouseLeave={handleHoldingLeave}
                          >
                            {h.name}
                            <span className={styles.holdingCode}>（{h.code}）</span>
                            {isNew && <span className={styles.newBadge}>新</span>}
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

      {hoveredHolding && (
        <HoldingKlinePopup
          code={hoveredHolding.code}
          name={hoveredHolding.name}
          endDate={holdings[hoveredHolding.periodIndex]?.endDate}
          anchorRect={hoveredHolding.rect}
          onMouseEnter={handlePopupEnter}
          onMouseLeave={handlePopupLeave}
        />
      )}
    </div>
  );
}
