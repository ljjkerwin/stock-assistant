import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  DatePicker,
  Empty,
  InputNumber,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloudSyncOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { darktradeApi } from '../../api/stock';
import type { DarkTradeData } from '../../types';
import DarkTradeTimesharePopup from './DarkTradeTimesharePopup';
import styles from './DarkTradeDiscovery.module.css';

const { Text, Title } = Typography;
const DEFAULT_MIN_DARK_CAPITAL_WAN = 2_000;
const DEFAULT_MIN_MULTIPLE = 2;

function formatCapital(value: number | null) {
  if (value == null) return '--';
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  return `${(value / 10_000).toFixed(0)} 万`;
}

function formatPercent(value: number | null) {
  if (value == null) return '--';
  const percent = value * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

export default function DarkTradeDiscovery() {
  const navigate = useNavigate();
  const [data, setData] = useState<DarkTradeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingIndex, setRefreshingIndex] = useState(false);
  const [minDarkCapitalWan, setMinDarkCapitalWan] = useState(DEFAULT_MIN_DARK_CAPITAL_WAN);
  const [minMultiple, setMinMultiple] = useState(DEFAULT_MIN_MULTIPLE);
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [hovered, setHovered] = useState<{ code: string; name: string; rect: DOMRect } | null>(
    null,
  );
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (darkCapitalWan: number, multiple: number, date: Dayjs) => {
    setLoading(true);
    try {
      setData(
        await darktradeApi.getDiscoveryStocks(
          darkCapitalWan * 10_000,
          multiple,
          date.format('YYYYMMDD'),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAllMarket = async () => {
    setRefreshingIndex(true);
    try {
      await darktradeApi.refreshIndex();
      await load(minDarkCapitalWan, minMultiple, selectedDate);
    } finally {
      setRefreshingIndex(false);
    }
  };

  useEffect(() => {
    void load(DEFAULT_MIN_DARK_CAPITAL_WAN, DEFAULT_MIN_MULTIPLE, dayjs());
  }, [load]);

  useEffect(
    () => () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    },
    [],
  );

  const handleStockEnter = (record: DarkTradeData, event: React.MouseEvent<HTMLElement>) => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    setHovered({
      code: record.code,
      name: record.name || record.code,
      rect: event.currentTarget.getBoundingClientRect(),
    });
  };

  const schedulePopupClose = () => {
    leaveTimerRef.current = setTimeout(() => setHovered(null), 200);
  };

  const keepPopupOpen = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
  };

  const columns: ColumnsType<DarkTradeData> = [
    {
      title: '股票',
      key: 'stock',
      render: (_, record) => (
        <Button
          type="link"
          className={styles.stockLink}
          onClick={() => navigate(`/stock/A/${record.code}`)}
          onMouseEnter={(event) => handleStockEnter(record, event)}
          onMouseLeave={schedulePopupClose}
        >
          {record.name || record.code}
          <Text type="secondary" className={styles.code}>
            {record.code}
          </Text>
        </Button>
      ),
    },
    {
      title: '最新价',
      dataIndex: 'latestPrice',
      align: 'right',
      render: (value: number | null) => value?.toFixed(2) ?? '--',
    },
    {
      title: '涨跌幅',
      dataIndex: 'changePct',
      align: 'right',
      render: (value: number | null) => (
        <span className={value != null && value < 0 ? styles.down : styles.up}>
          {formatPercent(value)}
        </span>
      ),
    },
    {
      title: '暗盘资金',
      dataIndex: 'darkCapital',
      align: 'right',
      render: (value: number | null) => (
        <strong className={styles.darkCapital}>{formatCapital(value)}</strong>
      ),
    },
    {
      title: '明盘资金',
      dataIndex: 'lightCapital',
      align: 'right',
      render: formatCapital,
    },
    {
      title: '暗/|明|倍数',
      key: 'multiple',
      align: 'right',
      render: (_, record) => {
        if (record.darkCapital == null || record.lightCapital == null || record.lightCapital === 0)
          return '--';
        return `${(record.darkCapital / Math.abs(record.lightCapital)).toFixed(2)} 倍`;
      },
    },
    {
      title: '行业',
      dataIndex: 'sector',
      render: (value: string) => (value ? <Tag>{value}</Tag> : '--'),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <Title level={4} className={styles.title}>
            明暗盘挖掘
          </Title>
          <Space size="middle" wrap>
            <Text type="secondary">日期</Text>
            <DatePicker
              value={selectedDate}
              format="YYYY-MM-DD"
              allowClear={false}
              disabledDate={(date) => date.isAfter(dayjs(), 'day')}
              onChange={(date) => {
                if (date) setSelectedDate(date);
              }}
            />
            <Text type="secondary">筛选暗盘资金超过</Text>
            <InputNumber
              min={0}
              precision={0}
              value={minDarkCapitalWan}
              addonAfter="万"
              formatter={(value) => (value == null ? '' : Number(value).toLocaleString('zh-CN'))}
              parser={(value) => Number((value ?? '').replace(/,/g, ''))}
              onChange={(value) => setMinDarkCapitalWan(value ?? DEFAULT_MIN_DARK_CAPITAL_WAN)}
            />
            <Text type="secondary">且大于明盘资金绝对值的</Text>
            <InputNumber
              min={0}
              precision={2}
              value={minMultiple}
              addonAfter="倍"
              onChange={(value) => setMinMultiple(value ?? DEFAULT_MIN_MULTIPLE)}
            />
            <Button
              type="primary"
              onClick={() => void load(minDarkCapitalWan, minMultiple, selectedDate)}
              loading={loading}
            >
              应用筛选
            </Button>
          </Space>
        </div>
        <Space>
          <Popconfirm
            title="刷新全市场明暗盘数据？"
            description="将抓取全市场数据，预计需要 5–10 秒。"
            okText="开始刷新"
            cancelText="取消"
            onConfirm={() => refreshAllMarket()}
          >
            <Button
              icon={<CloudSyncOutlined />}
              loading={refreshingIndex}
              disabled={loading && !refreshingIndex}
            >
              刷新今天全市场数据
            </Button>
          </Popconfirm>
        </Space>
      </div>
      <Table<DarkTradeData>
        rowKey="code"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{
          pageSize: 50,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 只`,
        }}
        locale={{ emptyText: <Empty description="当前暗盘索引中没有符合条件的股票" /> }}
        scroll={{ x: 760 }}
      />
      {hovered && (
        <DarkTradeTimesharePopup
          code={hovered.code}
          name={hovered.name}
          date={selectedDate.format('YYYY-MM-DD')}
          anchorRect={hovered.rect}
          onMouseEnter={keepPopupOpen}
          onMouseLeave={schedulePopupClose}
        />
      )}
    </div>
  );
}
