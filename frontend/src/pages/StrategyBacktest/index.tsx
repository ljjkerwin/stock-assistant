import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Row,
  Col,
  Card,
  Select,
  DatePicker,
  Button,
  Table,
  Typography,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { StarOutlined, StarFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import KLineChart from '../../components/KLineChart';
import { strategyApi, stocksApi } from '../../api/stock';
import { useFavoritesStore } from '../../store/favoritesStore';
import type { KlinePeriod, KlineBar } from '../../types';
import styles from './StrategyBacktest.module.css';

interface TradeRecord {
  type: 'buy' | 'sell';
  time: string;
  price: number;
  reason: string;
  profit?: number; // 盈亏百分比 %，仅卖出记录包含
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

interface CachedConfig {
  period: KlinePeriod;
  strategy: string; // 策略 id（稳定标识，展示名可变）
  startDate: string;
  endDate: string;
}

// ── localStorage helpers ───────────────────────────────────────────────────

// v2: 盈亏字段语义从「绝对价差」改为「百分比」，bump key 使旧缓存失效
const RESULT_KEY = 'backtest:result:v2';
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

function getCachedResult(key: string): BacktestResult | null {
  try {
    const entry = JSON.parse(localStorage.getItem(RESULT_KEY) ?? 'null') as { key: string; result: BacktestResult } | null;
    return entry?.key === key ? entry.result : null;
  } catch {
    return null;
  }
}

function setCachedResult(key: string, result: BacktestResult): void {
  try {
    localStorage.setItem(RESULT_KEY, JSON.stringify({ key, result }));
  } catch (e) {
    console.warn('backtest cache write failed', e);
  }
}

// The last backtest config is stored globally (not keyed by code), so switching
// to any stock — including one never backtested before — reuses the most recent
// period / strategy / date range. Market is always inferred from the code instead.
function getSavedConfig(): CachedConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? 'null') as CachedConfig | null;
    // Guard against legacy (per-code map) or malformed data
    if (!c || typeof c.period !== 'string' || typeof c.strategy !== 'string') return null;
    return c;
  } catch {
    return null;
  }
}

function saveConfig(config: CachedConfig): void {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('backtest config save failed', e);
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

// ── component ─────────────────────────────────────────────────────────────

export default function StrategyBacktest() {
  const { code } = useParams<{ code: string }>();
  const [market, setMarket] = useState<'A' | 'HK'>('A');
  const [period, setPeriod] = useState<KlinePeriod>('daily');
  // 策略以 id 标识（后端注册表键），name 仅用于展示，改名不影响识别
  const [strategies, setStrategies] = useState<{ id: string; name: string }[]>([]);
  const [strategy, setStrategy] = useState('');
  const [startDate, setStartDate] = useState(dayjs().subtract(6, 'months'));
  const [endDate, setEndDate] = useState(dayjs());
  const [result, setResult] = useState<BacktestResult | null>(null);
  // 当前展示结果对应的运行参数（区别于可能已被改动的表单状态），用于结果区信息展示
  const [resultMeta, setResultMeta] = useState<CachedConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [stockName, setStockName] = useState<string | null>(null);

  const { favorites, addStock, removeStock } = useFavoritesStore();
  const favoriteEntry = favorites.find((f) => f.market === market && f.code === code);
  const isFavorited = !!favoriteEntry;

  const toggleFavorite = () => {
    if (!code) return;
    if (isFavorited) {
      void removeStock(favoriteEntry!.id!);
    } else {
      void addStock({ code, market, name: stockName ?? favoriteEntry?.name ?? code });
    }
  };

  // Load the strategy list from the backend (single source of truth: id + name)
  useEffect(() => {
    strategyApi
      .list()
      .then(setStrategies)
      .catch(() => setStrategies([]));
  }, []);

  // Ensure the selected strategy is a valid id; fall back to the first available.
  // Handles legacy localStorage that stored a display name instead of an id.
  useEffect(() => {
    if (strategies.length === 0) return;
    if (!strategies.some((s) => s.id === strategy)) {
      setStrategy(strategies[0].id);
    }
  }, [strategies, strategy]);

  // Fetch stock name for the favorite label (falls back to code)
  useEffect(() => {
    if (!code) return;
    setStockName(null);
    stocksApi
      .getInfo(market, code)
      .then((info) => setStockName(info?.name ?? null))
      .catch(() => setStockName(null));
  }, [market, code]);

  // On code change (and initial mount / page refresh): infer the market from the
  // code, restore the most recent backtest config, and reuse a cached result if
  // this exact code + config combination was backtested before.
  useEffect(() => {
    if (!code) return;
    const inferredMarket: 'A' | 'HK' = /^\d{6}$/.test(code) ? 'A' : 'HK';
    setMarket(inferredMarket);

    const saved = getSavedConfig();
    if (saved) {
      setPeriod(saved.period);
      setStrategy(saved.strategy);
      setStartDate(dayjs(saved.startDate));
      setEndDate(dayjs(saved.endDate));

      const key = buildKey(code, inferredMarket, saved.period, saved.strategy, saved.startDate, saved.endDate);
      const cached = getCachedResult(key);
      if (cached) {
        setResult(cached);
        setResultMeta({ period: saved.period, strategy: saved.strategy, startDate: saved.startDate, endDate: saved.endDate });
        setFromCache(true);
        return;
      }
    }

    setResult(null);
    setResultMeta(null);
    setFromCache(false);
  }, [code]);

  const handleBacktest = async () => {
    if (!code || !strategy) return;

    const startStr = startDate.format('YYYY-MM-DD');
    const endStr = endDate.format('YYYY-MM-DD');
    const key = buildKey(code, market, period, strategy, startStr, endStr);

    // Clear cached result and zoom so the chart always shows fresh data and resets view
    try {
      localStorage.removeItem(RESULT_KEY);
    } catch { /* ignore */ }
    try {
      localStorage.removeItem(`kline:zoom:${code}`);
    } catch { /* ignore */ }

    setLoading(true);
    setFromCache(false);
    try {
      const res = await strategyApi.backtest({ market, code, startDate: startStr, endDate: endStr, period, strategy });
      setResult(res);
      setResultMeta({ period, strategy, startDate: startStr, endDate: endStr });
      setFromCache(false);
      setCachedResult(key, res);
      saveConfig({ period, strategy, startDate: startStr, endDate: endStr });
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
            {profit.toFixed(2)}%
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
      <Card
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {`策略回测 - ${stockName ? `${stockName} ` : ''}${code}`}
            <Tooltip title={isFavorited ? '取消收藏' : '添加收藏'}>
              <Button
                type="text"
                size="small"
                icon={isFavorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                onClick={toggleFavorite}
              />
            </Tooltip>
          </span>
        }
        className={styles.card}
      >
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
                    value={strategy || undefined}
                    onChange={setStrategy}
                    options={strategies.map((s) => ({ value: s.id, label: s.name }))}
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
                  {resultMeta && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, marginBottom: 16, color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
                      <span>标的：{stockName ? `${stockName} ` : ''}{code}（{market === 'A' ? 'A股' : '港股'}）</span>
                      <span>K线周期：{PERIODS.find((p) => p.value === resultMeta.period)?.label ?? resultMeta.period}</span>
                      <span>策略：{strategies.find((s) => s.id === resultMeta.strategy)?.name ?? resultMeta.strategy}</span>
                      <span>回测时间区间：{resultMeta.startDate} ~ {resultMeta.endDate}</span>
                    </div>
                  )}
                  <div className={styles.statRow}>
                    <span>区间涨跌：<span style={{
                      color: result.priceChangePercent > 0 ? '#ef5350' : '#26a69a',
                    }}>{toPercent(result.priceChangePercent)}</span></span>

                    <span>回测收益：<span style={{
                      color: result.returnPercent > 0 ? '#ef5350' : '#26a69a',
                    }}>{toPercent(result.returnPercent)}</span></span>

                    <span>最大回撤：<span style={{
                      color: '#26a69a',
                    }}>{toPercent(result.maxDrawdown)}</span></span>

                    <span>夏普比率：<span>{result.sharpeRatio.toFixed(2)}</span></span>

                    <span>交易次数：<span>{result.tradeCount}</span></span>
                  </div>
                </Card>
              </Col>

              <Col span={24}>
                <Card type="inner" title="K线图" size="small">
                  <KLineChart
                    market={market}
                    code={code || ''}
                    initialData={{ data: result.klines, period, backtestStartTime: result.backtestStartTime }}
                    zoomStorageKey={code}
                    showPeriodTabs={false}
                    showRsi
                    showLjj
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


// 转成百分比，并保留两位小数，不要四舍五入
function toPercent(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2) + '%';
}