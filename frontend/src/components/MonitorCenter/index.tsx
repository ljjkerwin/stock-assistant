import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Empty, Modal, Tabs, Tag, Tooltip, Typography } from 'antd';
import { BellOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMonitorStore } from '../../store/monitorStore';
import { useMonitorSSE } from '../../hooks/useMonitorSSE';
import type { MaPeriod, MonitorMessage, MonitorRule, MonitorType } from '../../types';
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

function MessageItem({ msg, onClickStock }: { msg: MonitorMessage; onClickStock: () => void }) {
  const isMA = msg.type === 'ma_cross_above' || msg.type === 'ma_cross_below';
  return (
    <div className={`${styles.listItem} ${msg.read ? styles.read : ''}`}>
      <div className={styles.itemRow}>
        <Typography.Link strong style={{ fontSize: 13 }} onClick={onClickStock}>
          {msg.stockName}
        </Typography.Link>
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

function RuleItem({
  rule,
  onToggle,
  onDelete,
  onClickStock,
}: {
  rule: MonitorRule;
  onToggle: () => void;
  onDelete: () => void;
  onClickStock: () => void;
}) {
  return (
    <div className={styles.ruleItem}>
      <div className={styles.itemRow}>
        <Typography.Link strong style={{ fontSize: 13 }} onClick={onClickStock}>
          {rule.stockName}
        </Typography.Link>
        <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1, marginLeft: 4 }}>
          {rule.stockCode} · {rule.stockMarket === 'HK' ? '港股' : 'A股'}
        </Typography.Text>
        <Tooltip title={rule.active ? '暂停监控' : '重新激活'}>
          <Tag
            color={rule.active ? 'success' : 'default'}
            style={{ cursor: 'pointer', marginRight: 4 }}
            onClick={onToggle}
          >
            {rule.active ? '监控中' : '已暂停'}
          </Tag>
        </Tooltip>
        <Tooltip title="删除规则">
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={onDelete}
          />
        </Tooltip>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <Typography.Text style={{ fontSize: 12 }} type="secondary">
          {conditionText(rule.type, rule.targetPrice, rule.maPeriod, rule.klinePeriod)}
        </Typography.Text>
        {rule.lastTriggeredAt && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            上次触发 {fmtTime(rule.lastTriggeredAt)}
          </Typography.Text>
        )}
      </div>
    </div>
  );
}

export default function MonitorCenter() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('messages');
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useMonitorSSE();

  const {
    rules,
    messages,
    messagesTotal,
    messagesPage,
    unreadCount,
    fetchRules,
    fetchMessages,
    fetchUnreadCount,
    deleteRule,
    toggleRule,
  } = useMonitorStore();

  useEffect(() => {
    void fetchRules();
    void fetchUnreadCount();
  }, [fetchRules, fetchUnreadCount]);

  const handleOpen = () => {
    setOpen(true);
    setActiveTab('messages');
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
  }, [hasMore, messagesPage, fetchMessages, activeTab, open]);

  const sortedRules = [...rules].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  const tabItems = [
    {
      key: 'messages',
      label: (
        <Badge count={unreadCount} size="small" offset={[10, -2]}>
          消息通知
        </Badge>
      ),
      children: (
        <>
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
              style={{ marginTop: 32, marginBottom: 32 }}
            />
          ) : (
            <div className={styles.scrollList} ref={scrollRef}>
              {messages.map((msg) => (
                <MessageItem
                  key={msg.id}
                  msg={msg}
                  onClickStock={() => {
                    navigate(`/stock/${msg.stockMarket}/${msg.stockCode}`);
                    setOpen(false);
                  }}
                />
              ))}
              {hasMore && loadingMore && (
                <div style={{ textAlign: 'center', padding: '8px 0', color: '#999', fontSize: 12 }}>
                  加载中…
                </div>
              )}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'rules',
      label: `监控规则 (${rules.length})`,
      children: (
        <>
          {rules.length === 0 ? (
            <Empty
              description="暂无监控规则"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 32, marginBottom: 32 }}
            />
          ) : (
            <div className={styles.scrollList}>
              {sortedRules.map((rule) => (
                <RuleItem
                  key={rule.id}
                  rule={rule}
                  onToggle={() => void toggleRule(rule.id, !rule.active)}
                  onDelete={() => void deleteRule(rule.id)}
                  onClickStock={() => {
                    navigate(`/stock/${rule.stockMarket}/${rule.stockCode}`);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </>
      ),
    },
  ];

  return (
    <>
      <div className={styles.trigger}>
        <Badge count={unreadCount} size="small" offset={[-2, 2]}>
          <Button
            type="text"
            size="small"
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
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
        />
      </Modal>
    </>
  );
}

MonitorCenter.displayName = 'MonitorCenter';
