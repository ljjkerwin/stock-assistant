import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Empty, Modal, Typography } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useMonitorStore } from '../../store/monitorStore';
import { useMonitorSSE } from '../../hooks/useMonitorSSE';
import type { MaPeriod, MonitorMessage, MonitorType } from '../../types';
import styles from './MonitorCenter.module.css';

function conditionText(
  type: MonitorType,
  targetPrice: number | null,
  maPeriod: MaPeriod | null,
  klinePeriod: string | null,
): string {
  const periodLabel =
    klinePeriod === 'daily' || !klinePeriod
      ? '日线'
      : klinePeriod === '5min'
      ? '5min线'
      : klinePeriod === '15min'
      ? '15min线'
      : klinePeriod === '30min'
      ? '30min线'
      : klinePeriod === '60min'
      ? '60min线'
      : `${klinePeriod}`;
  switch (type) {
    case 'price_above':
      return `突破 ¥${targetPrice?.toFixed(2) ?? '-'}`;
    case 'price_below':
      return `跌破 ¥${targetPrice?.toFixed(2) ?? '-'}`;
    case 'ma_cross_above':
      return `${periodLabel} 突破 ${(maPeriod ?? '').toUpperCase()}`;
    case 'ma_cross_below':
      return `${periodLabel} 跌破 ${(maPeriod ?? '').toUpperCase()}`;
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function MessageItem({ msg }: { msg: MonitorMessage }) {
  const isMA = msg.type === 'ma_cross_above' || msg.type === 'ma_cross_below';
  return (
    <div className={`${styles.listItem} ${msg.read ? styles.read : ''}`}>
      <div className={styles.itemRow}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {msg.stockName}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1, marginLeft: 4 }}>
          {msg.stockCode} · {msg.stockMarket === 'HK' ? '港股' : 'A股'}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {fmtTime(msg.triggeredAt)}
        </Typography.Text>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {conditionText(msg.type, isMA ? null : msg.targetValue, msg.maPeriod, msg.klinePeriod)} 已触发
        {' ｜ '}当前价 ¥{msg.currentPrice.toFixed(2)}
        {isMA && ` · ${(msg.maPeriod ?? '').toUpperCase()} ¥${msg.targetValue.toFixed(2)}`}
      </Typography.Text>
    </div>
  );
}

export default function MonitorCenter() {
  const [open, setOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useMonitorSSE();

  const {
    messages,
    messagesTotal,
    messagesPage,
    unreadCount,
    fetchRules,
    fetchMessages,
    fetchUnreadCount,
  } = useMonitorStore();

  useEffect(() => {
    void fetchRules();
    void fetchUnreadCount();
  }, [fetchRules, fetchUnreadCount]);

  const handleOpen = () => {
    setOpen(true);
    void fetchMessages(1);
  };

  const hasMore = messages.length < messagesTotal;
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (loadingMoreRef.current || !hasMore) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
        loadingMoreRef.current = true;
        setLoadingMore(true);
        void fetchMessages(messagesPage + 1).finally(() => {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        });
      }
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, messagesPage, fetchMessages]);

  return (
    <>
      <div className={styles.trigger}>
        <Badge count={unreadCount} size="small" offset={[-4, 4]}>
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={<BellOutlined />}
            onClick={handleOpen}
          />
        </Badge>
      </div>

      <Modal
        title="消息中心"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={480}
        styles={{ body: { padding: '8px 16px' } }}
      >
        {messages.length > 0 && (
          <div className={styles.tabToolbar}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              共 {messagesTotal} 条
            </Typography.Text>
          </div>
        )}
        {messages.length === 0 ? (
          <Empty
            description="暂无消息"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 32 }}
          />
        ) : (
          <div className={styles.scrollList} ref={scrollRef}>
            {messages.map((msg) => (
              <MessageItem key={msg.id} msg={msg} />
            ))}
            {hasMore && loadingMore && (
              <div style={{ textAlign: 'center', padding: '8px 0', color: '#999', fontSize: 12 }}>
                加载中…
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

MonitorCenter.displayName = 'MonitorCenter';
