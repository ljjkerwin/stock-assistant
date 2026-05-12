import { useEffect, useState } from 'react';
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
): string {
  switch (type) {
    case 'price_above':
      return `突破 ¥${targetPrice?.toFixed(2) ?? '-'}`;
    case 'price_below':
      return `跌破 ¥${targetPrice?.toFixed(2) ?? '-'}`;
    case 'ma_cross_above':
      return `突破 ${(maPeriod ?? '').toUpperCase()}`;
    case 'ma_cross_below':
      return `跌破 ${(maPeriod ?? '').toUpperCase()}`;
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
        {conditionText(msg.type, isMA ? null : msg.targetValue, msg.maPeriod)} 已触发
        {' ｜ '}当前价 ¥{msg.currentPrice.toFixed(2)}
        {isMA && ` · ${(msg.maPeriod ?? '').toUpperCase()} ¥${msg.targetValue.toFixed(2)}`}
      </Typography.Text>
    </div>
  );
}

export default function MonitorCenter() {
  const [open, setOpen] = useState(false);

  useMonitorSSE();

  const { messages, fetchRules, fetchMessages, markAllRead, clearMessages } = useMonitorStore();

  useEffect(() => {
    void fetchRules();
    void fetchMessages();
  }, [fetchRules, fetchMessages]);

  const unreadCount = messages.filter((m) => !m.read).length;

  return (
    <>
      <div className={styles.trigger}>
        <Badge count={unreadCount} size="small" offset={[-4, 4]}>
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={<BellOutlined />}
            onClick={() => setOpen(true)}
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
            <Button size="small" onClick={markAllRead} disabled={unreadCount === 0}>
              全部已读
            </Button>
            <Button size="small" danger onClick={() => void clearMessages()}>
              清空
            </Button>
          </div>
        )}
        {messages.length === 0 ? (
          <Empty
            description="暂无消息"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 32 }}
          />
        ) : (
          <div className={styles.scrollList}>
            {messages.map((msg) => (
              <MessageItem key={msg.id} msg={msg} />
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

MonitorCenter.displayName = 'MonitorCenter';
