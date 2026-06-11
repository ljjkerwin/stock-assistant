import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Row,
  Col,
  Card,
  Select,
  DatePicker,
  Button,
  Statistic,
  Table,
  Typography,
  Tag,
  message,
} from 'antd';
import dayjs from 'dayjs';
import KLineChart from '../../components/KLineChart';
import { strategyApi } from '../../api/stock';
import type { KlinePeriod, KlineBar } from '../../types';
import styles from './StrategyBacktest.module.css';

interface TradeRecord {
  type: 'buy' | 'sell';
  time: string;
  price: number;
  reason: string;
  profit?: number;
}

interface BacktestResult {
  priceChangePercent: number;
  returnPercent: number;
  maxDrawdown: number;
  sharpeRatio: number;
  tradeCount: number;
  trades: TradeRecord[];
  klines: KlineBar[];
  backtestStartTime?: string | null;
}

interface CachedParams {
  market: 'A' | 'HK';
  period: KlinePeriod;
  strategy: string;
  startDate: string;
  endDate: string;
}

// ── localStorage helpers ───────────────────────────────────────────────────

const RESULTS_KEY = 'backtest:results';
const PARAMS_KEY = 'backtest:params';

function buildKey(
  code: string,
  market: string,
  period: string,
  strategy: string,
  startDate: string,
  endDate: string,
): string {
  return [code, market, period, strategy, startDate, endDate].join('|');
}

function readResultCache(): Record<string, BacktestResult> {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '{}') as Record<string, BacktestResult>;
  } catch {
    return {};
  }
}

function getCachedResult(key: string): BacktestResult | null {
  return readResultCache()[key] ?? null;
}

function setCachedResult(key: string, result: BacktestResult): void {
  try {
    const cache = readResultCache();
    const keys = Object.keys(cache);
    if (keys.length >= 30) delete cache[keys[0]];
    cache[key] = result;
    localStorage.setItem(RESULTS_KEY, JSON.stringify(cache));
  } catch {
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify({ [key]: result }));
    } catch (e) {
      console.warn('backtest cache write failed', e);
    }
  }
}

function getSavedParams(code: string): CachedParams | null {
  try {
    const all = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '{}') as Record<string, CachedParams>;
    return all[code] ?? null;
  } catch {
    return null;
  }
}

function saveParams(code: string, params: CachedParams): void {
  try {
    const all = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '{}') as Record<string, CachedParams>;
    all[code] = params;
    localStorage.setItem(PARAMS_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('backtest params save failed', e);
  }
}

// ── constants ─────────────────────────────────────────────────────────────

const PERIODS: { value: KlinePeriod; label: string }[] = [
  { value: 'daily', label: '日线' },
  { value: '5min', label: '5分钟' },
  { value: '15min', label: '15分钟' },
  { value: '30min', label: '30分钟' },
  { value: '60min', label: '60分钟' },
];

const STRATEGIES = ['趋势策略'];

// ── component ─────────────────────────────────────────────────────────────

export default function StrategyBacktest() {
  const { code } = useParams<{ code: string }>();
  const [market, setMarket] = useState<'A' | 'HK'>('A');
  const [period, setPeriod] = useState<KlinePeriod>('daily');
  const [strategy, setStrategy] = useState('趋势策略');
  const [startDate, setStartDate] = useState(dayjs().subtract(6, 'months'));
  const [endDate, setEndDate] = useState(dayjs());
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  // On code change: restore last params for this code and hit cache if available
  useEffect(() => {
    if (!code) return;
    const inferredMarket: 'A' | 'HK' = /^\d{6}$/.test(code) ? 'A' : 'HK';

    const saved = getSavedParams(code);
    if (saved) {
      setMarket(saved.market);
      setPeriod(saved.period);
      setStrategy(saved.strategy);
      setStartDate(dayjs(saved.startDate));
      setEndDate(dayjs(saved.endDate));

      const key = buildKey(code, saved.market, saved.period, saved.strategy, saved.startDate, saved.endDate);
      const cached = getCachedResult(key);
      if (cached) {
        setResult(cached);
        setFromCache(true);
        return;
      }
    } else {
      setMarket(inferredMarket);
    }

    setResult(null);
    setFromCache(false);
  }, [code]);

  const handleBacktest = async () => {
    if (!code) return;

    const startStr = startDate.format('YYYY-MM-DD');
    const endStr = endDate.format('YYYY-MM-DD');
    const key = buildKey(code, market, period, strategy, startStr, endStr);

    // Clear cached result and zoom so the chart always shows fresh data and resets view
    try {
      const cache = readResultCache();
      delete cache[key];
      localStorage.setItem(RESULTS_KEY, JSON.stringify(cache));
    } catch { /* ignore */ }
    try {
      localStorage.removeItem(`kline:zoom:${code}`);
    } catch { /* ignore */ }

    setLoading(true);
    setFromCache(false);
    try {
      const res = await strategyApi.backtest({ market, code, startDate: startStr, endDate: endStr, period, strategy });
      setResult(res);
      setFromCache(false);
      setCachedResult(key, res);
      saveParams(code, { market, period, strategy, startDate: startStr, endDate: endStr });
    } catch (err) {
      message.error('回测失败，请检查参数');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const tradeColumns = [
    {
      title: '操作',
      dataIndex: 'type',
      key: 'type',
      width: '8%',
      render: (type: string) => (
        <span style={{ color: type === 'buy' ? '#ef5350' : '#26a69a', fontWeight: 600 }}>
          {type === 'buy' ? '买入' : '卖出'}
        </span>
      ),
    },
    {
      title: '时间',
      dataIndex: 'time',
      key: 'time',
      width: '22%',
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: '12%',
      render: (price: number) => price.toFixed(2),
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
    },
    {
      title: '盈亏',
      dataIndex: 'profit',
      key: 'profit',
      width: '14%',
      render: (profit: number | undefined) =>
        profit !== undefined ? (
          <span style={{ color: profit > 0 ? '#ef5350' : '#26a69a', fontWeight: 600 }}>
            {profit > 0 ? '+' : ''}
            {profit.toFixed(2)}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  if (!code) {
    return (
      <div className={styles.container} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Typography.Text type="secondary">从左侧列表选择股票以开始回测</Typography.Text>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Card title={`策略回测 - ${code}`} className={styles.card}>
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Row gutter={[16, 16]}>
              <Col span={6}>
                <div className={styles.formGroup}>
                  <label>K线周期</label>
                  <Select
                    value={period}
                    onChange={setPeriod}
                    options={PERIODS}
                  />
                </div>
              </Col>
              <Col span={6}>
                <div className={styles.formGroup}>
                  <label>策略</label>
                  <Select
                    value={strategy}
                    onChange={setStrategy}
                    options={STRATEGIES.map((s) => ({ value: s, label: s }))}
                  />
                </div>
              </Col>
              <Col span={6}>
                <div className={styles.formGroup}>
                  <label>开始时间</label>
                  <DatePicker
                    value={startDate}
                    onChange={(date) => date && setStartDate(date)}
                    style={{ width: '100%' }}
                  />
                </div>
              </Col>
              <Col span={6}>
                <div className={styles.formGroup}>
                  <label>结束时间</label>
                  <DatePicker
                    value={endDate}
                    onChange={(date) => date && setEndDate(date)}
                    style={{ width: '100%' }}
                  />
                </div>
              </Col>
            </Row>
          </Col>

          <Col span={24}>
            <Button
              type="primary"
              onClick={handleBacktest}
              loading={loading}
              size="large"
            >
              开始回测
            </Button>
          </Col>

          {result && (
            <>
              <Col span={24}>
                <Card
                  type="inner"
                  title={
                    <span>
                      回测结果{fromCache && <Tag color="default" style={{ marginLeft: 8, fontSize: 11 }}>已缓存</Tag>}
                    </span>
                  }
                  size="small"
                >
                  <Row gutter={[32, 16]}>
                    <Col span={4}>
                      <Statistic
                        title="区间涨跌"
                        value={result.priceChangePercent}
                        precision={2}
                        suffix="%"
                        styles={{
                          content: {
                            color: result.priceChangePercent > 0 ? '#ef5350' : '#26a69a',
                          },
                        }}
                      />
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title="回测收益"
                        value={result.returnPercent}
                        precision={2}
                        suffix="%"
                        styles={{
                          content: {
                            color: result.returnPercent > 0 ? '#ef5350' : '#26a69a',
                          },
                        }}
                      />
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title="最大回撤"
                        value={result.maxDrawdown}
                        precision={2}
                        suffix="%"
                        styles={{ content: { color: '#26a69a' } }}
                      />
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title="夏普比率"
                        value={result.sharpeRatio}
                        precision={2}
                      />
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title="交易次数"
                        value={result.tradeCount}
                      />
                    </Col>
                  </Row>
                </Card>
              </Col>

              <Col span={24}>
                <Card type="inner" title="K线图" size="small">
                  <KLineChart
                    market={market}
                    code={code || ''}
                    initialData={{ data: result.klines, period, backtestStartTime: result.backtestStartTime }}
                    zoomStorageKey={code}
                  />
                </Card>
              </Col>

              {result.trades.length > 0 && (
                <Col span={24}>
                  <Card type="inner" title="交易记录" size="small">
                    <Table
                      dataSource={result.trades.map((t, i) => ({ ...t, key: i }))}
                      columns={tradeColumns}
                      pagination={false}
                      size="small"
                    />
                  </Card>
                </Col>
              )}
            </>
          )}
        </Row>
      </Card>
    </div>
  );
}
