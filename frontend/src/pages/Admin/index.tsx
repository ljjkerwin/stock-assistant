import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatePicker, Button, Input, Popover, Spin, message } from 'antd';
import {
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LineChartOutlined,
  SearchOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import KLineChart from '../../components/KLineChart';
import { darktradeApi } from '../../api/stock';
import type { DarkTradeData } from '../../types';
import styles from './Admin.module.css';

interface FetchResult {
  date: string;
  total: number;
  written: number;
}

interface LlmSearchHistoryItem {
  text: string;
  date: Dayjs;
  names: string[];
  results: DarkTradeData[];
  notFoundNames: string[];
}

interface RecentSearchResult {
  data: DarkTradeData;
  queryText: string;
}

const MAX_RECENT_SEARCH_RESULTS = 5;
const MAX_LLM_SEARCH_HISTORY = 3;

function formatCapital(value: number | null) {
  if (value == null) return '--';
  const divisor = Math.abs(value) >= 10_000_000 ? 100_000_000 : 10_000;
  const suffix = divisor === 100_000_000 ? 'y' : 'w';
  const digits = suffix === 'y' ? 2 : 0;
  const formatted = Number((value / divisor).toFixed(digits));
  return `${value > 0 ? '+' : ''}${formatted}${suffix}`;
}

function formatDate(date: string) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function formatCapitalSummary(data: DarkTradeData) {
  return `${data.displayName ?? data.name}，暗${formatCapital(data.darkCapital)}，明${formatCapital(data.lightCapital)}`;
}

export default function Admin() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchDate, setSearchDate] = useState<Dayjs>(dayjs());
  const [stockName, setStockName] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [recentSearchResults, setRecentSearchResults] = useState<RecentSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [llmText, setLlmText] = useState('');
  const [llmSearchDate, setLlmSearchDate] = useState<Dayjs>(dayjs());
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmSearchHistory, setLlmSearchHistory] = useState<LlmSearchHistoryItem[]>([]);

  const handleFetch = async () => {
    if (!selectedDate || loading) return;
    const dateStr = selectedDate.format('YYYYMMDD');
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await darktradeApi.fetchAllDailySnapshot(dateStr);
      setResult(res);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : typeof e === 'string' ? e : '请求失败，请查看后端日志';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    const name = stockName.trim();
    if (!name || searchLoading) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const data = await darktradeApi.getDailyResultByName(name, searchDate.format('YYYYMMDD'));
      if (data) {
        setRecentSearchResults((current) => [
          { data, queryText: name },
          ...current.filter(
            (item) => item.data.code !== data.code || item.data.date !== data.date,
          ),
        ].slice(0, MAX_RECENT_SEARCH_RESULTS));
      } else {
        setSearchError('未找到该日期的资金数据，请确认股票名称或先采集该日期数据');
      }
    } catch (e: unknown) {
      setSearchError(e instanceof Error ? e.message : '查询失败，请稍后重试');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleCopyCapitalSummary = async (data: DarkTradeData) => {
    const summary = formatCapitalSummary(data);
    try {
      await navigator.clipboard.writeText(summary);
      message.success('资金文案已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  const handleLlmSearch = async () => {
    const text = llmText.trim();
    if (!text || llmLoading) return;
    setLlmLoading(true);
    setLlmError(null);
    try {
      const data = await darktradeApi.getDailyResultsFromText(text, llmSearchDate.format('YYYYMMDD'));
      setLlmSearchHistory((current) => {
        const item: LlmSearchHistoryItem = {
          text,
          date: llmSearchDate,
          names: data.names,
          results: data.results,
          notFoundNames: data.notFoundNames,
        };
        return [
          item,
          ...current.filter(
            (history) =>
              history.text !== text || !history.date.isSame(llmSearchDate, 'day'),
          ),
        ].slice(0, MAX_LLM_SEARCH_HISTORY);
      });
    } catch (e: unknown) {
      setLlmError(e instanceof Error ? e.message : '模型查询失败，请稍后重试');
    } finally {
      setLlmLoading(false);
    }
  };

  const renderDailyKlinePopoverTitle = (data: DarkTradeData) => (
    <button
      type="button"
      className={styles.dailyKlinePopoverTitle}
      onClick={() => navigate(`/stock/A/${data.code}`)}
      title={`前往${data.name}详情页`}
    >
      {data.name}（{data.code}）· 日线
    </button>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>管理中心</h1>
        <p className={styles.subtitle}>数据维护与系统操作工具集</p>
      </div>

      <div className={styles.grid}>
        {/* 模块一：全市场明暗盘日终数据采集 */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon}>
              <DatabaseOutlined style={{ color: '#fff' }} />
            </div>
            <div>
              <p className={styles.cardTitle}>全市场明暗盘日终数据采集</p>
              <p className={styles.cardDesc}>
                扫描全市场（约 5300 只）指定日期的明暗盘收盘数据，写入副图数据库
              </p>
            </div>
          </div>

          <div className={styles.controls}>
            <DatePicker
              value={selectedDate}
              onChange={(date) => {
                if (date) setSelectedDate(date);
              }}
              format="YYYY-MM-DD"
              allowClear={false}
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              style={{ width: 160 }}
            />
            <Button
              type="primary"
              loading={loading}
              onClick={handleFetch}
              disabled={!selectedDate}
              style={{
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                height: 36,
                paddingInline: 20,
              }}
            >
              获取并写入数据库
            </Button>
          </div>

          {loading && (
            <div className={styles.loadingState}>
              <Spin size="small" />
              <span>
                正在抓取 {selectedDate.format('YYYY-MM-DD')} 全市场数据，约需 5–10 秒...
              </span>
            </div>
          )}

          {result && !loading && (
            <div className={`${styles.result} ${styles.resultSuccess}`}>
              <p className={`${styles.resultTitle} ${styles.resultTitleSuccess}`}>
                <CheckCircleOutlined style={{ marginRight: 6 }} />
                采集完成
              </p>
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>日期</span>
                  <span className={styles.statValue}>
                    {result.date.slice(0, 4)}-{result.date.slice(4, 6)}-{result.date.slice(6, 8)}
                  </span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>索引总数</span>
                  <span className={styles.statValue}>{result.total.toLocaleString()}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>写入快照</span>
                  <span className={`${styles.statValue} ${styles.statValueGreen}`}>
                    {result.written.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className={`${styles.result} ${styles.resultError}`}>
              <p className={`${styles.resultTitle} ${styles.resultTitleError}`}>
                <CloseCircleOutlined style={{ marginRight: 6 }} />
                采集失败
              </p>
              <p className={styles.errorMsg}>{error}</p>
            </div>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={`${styles.cardIcon} ${styles.searchIcon}`}>
              <SearchOutlined style={{ color: '#fff' }} />
            </div>
            <div>
              <p className={styles.cardTitle}>收盘暗盘资金查询</p>
              <p className={styles.cardDesc}>按日期和个股名称查询 15:00 收盘时的暗盘、明盘资金</p>
            </div>
          </div>

          <div className={styles.controls}>
            <DatePicker
              value={searchDate}
              onChange={(date) => date && setSearchDate(date)}
              format="YYYY-MM-DD"
              allowClear={false}
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              style={{ width: 160 }}
            />
            <Input
              value={stockName}
              onChange={(event) => setStockName(event.target.value)}
              onPressEnter={() => void handleSearch()}
              placeholder="名称/拼音首字母，例如：华电ln、zjxc"
              style={{ width: 240 }}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={searchLoading}
              disabled={!stockName.trim()}
              onClick={() => void handleSearch()}
              className={styles.searchButton}
            >
              搜索
            </Button>
          </div>

          {recentSearchResults.length > 0 && !searchLoading && (
            <div className={styles.searchResults}>
              {recentSearchResults.map(({ data: searchResult, queryText }) => (
                <div
                  key={`${searchResult.date}:${searchResult.code}`}
                  className={`${styles.result} ${styles.llmHistoryItem}`}
                >
                  <p className={styles.llmHistoryTitle}>
                    {formatDate(searchResult.date)} · {queryText}
                  </p>
                  <div className={styles.llmStockList}>
                    <div className={styles.llmStockItem}>
                      <span>
                        {searchResult.name}（{searchResult.code}）
                      </span>
                      <Popover
                        trigger="hover"
                        placement="leftTop"
                        mouseEnterDelay={0.15}
                        destroyOnHidden
                        title={renderDailyKlinePopoverTitle(searchResult)}
                        content={
                          <div className={styles.dailyKlinePopover}>
                            <KLineChart
                              market="A"
                              code={searchResult.code}
                              period="daily"
                              showPeriodTabs={false}
                              showMacd={false}
                              showDarkTrade
                              defaultZoomMultiplier={1.5}
                              highlightDate={searchResult.date}
                            />
                          </div>
                        }
                      >
                        <Button
                          type="text"
                          size="small"
                          className={styles.dailyKlineButton}
                          aria-label={`查看${searchResult.name}日线 K 线图`}
                        >
                          <LineChartOutlined />
                        </Button>
                      </Popover>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`${styles.result} ${styles.resultSuccess} ${styles.llmSummary}`}
                    onClick={() => void handleCopyCapitalSummary(searchResult)}
                    title="点击复制资金文案"
                  >
                    {formatCapitalSummary(searchResult)}
                  </button>
                </div>
              ))}
            </div>
          )}

          {searchError && !searchLoading && (
            <div className={`${styles.result} ${styles.resultError}`}>
              <p className={styles.errorMsg}>{searchError}</p>
            </div>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={`${styles.cardIcon} ${styles.llmIcon}`}>
              <RobotOutlined style={{ color: '#fff' }} />
            </div>
            <div>
              <p className={styles.cardTitle}>收盘暗盘资金 LLM 查询</p>
              <p className={styles.cardDesc}>
                从一句话中识别多个可能提及的股票，再批量查询并拼接收盘资金文案
              </p>
            </div>
          </div>

          <div className={styles.llmControls}>
            <DatePicker
              value={llmSearchDate}
              onChange={(date) => date && setLlmSearchDate(date)}
              format="YYYY-MM-DD"
              allowClear={false}
              disabledDate={(date) => date.isAfter(dayjs(), 'day')}
              style={{ width: 160 }}
              className={styles.llmDatePicker}
            />
            <Input.TextArea
              value={llmText}
              onChange={(event) => setLlmText(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  void handleLlmSearch();
                }
              }}
              placeholder="例如：今天关注一下贵州茅台、宁德时代和中芯国际的资金情况"
              autoSize={{ minRows: 2, maxRows: 4 }}
              className={styles.llmInput}
            />
            <Button
              type="primary"
              icon={<RobotOutlined />}
              loading={llmLoading}
              disabled={!llmText.trim()}
              onClick={() => void handleLlmSearch()}
              className={styles.llmButton}
            >
              提取并查询
            </Button>
          </div>

          {llmSearchHistory.length > 0 && (
            <div className={styles.llmHistory}>
              {llmSearchHistory.map((history) => (
                <div
                  key={`${history.date.format('YYYYMMDD')}:${history.text}`}
                  className={`${styles.result} ${styles.llmHistoryItem}`}
                >
                  <p className={styles.llmHistoryTitle}>
                    {history.date.format('YYYY-MM-DD')} · {history.text}
                  </p>

                  {history.names.length > 0 && (
                    <div className={styles.llmMeta}>模型识别：{history.names.join('、')}</div>
                  )}

                  {history.results.length > 0 ? (
                    <>
                      <div className={styles.llmStockList}>
                        {history.results.map((searchResult) => (
                          <div
                            key={`${searchResult.date}:${searchResult.code}`}
                            className={styles.llmStockItem}
                          >
                            <span>
                              {searchResult.name}（{searchResult.code}）
                            </span>
                            <Popover
                              trigger="hover"
                              placement="leftTop"
                              mouseEnterDelay={0.15}
                              destroyOnHidden
                              title={renderDailyKlinePopoverTitle(searchResult)}
                              content={
                                <div className={styles.dailyKlinePopover}>
                                  <KLineChart
                                    market="A"
                                    code={searchResult.code}
                                    period="daily"
                                    showPeriodTabs={false}
                                    showMacd={false}
                                    showDarkTrade
                                    defaultZoomMultiplier={1.5}
                                    highlightDate={searchResult.date}
                                  />
                                </div>
                              }
                            >
                              <Button
                                type="text"
                                size="small"
                                className={styles.dailyKlineButton}
                                aria-label={`查看${searchResult.name}日线 K 线图`}
                              >
                                <LineChartOutlined />
                              </Button>
                            </Popover>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={`${styles.result} ${styles.resultSuccess} ${styles.llmSummary}`}
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(history.results.map(formatCapitalSummary).join('；'))
                            .then(() => message.success('资金文案已复制'))
                            .catch(() => message.error('复制失败，请手动复制'))
                        }
                        title="点击复制全部资金文案"
                      >
                        {history.results.map(formatCapitalSummary).join('；')}
                      </button>
                    </>
                  ) : (
                    <div className={styles.llmEmptyResult}>未查询到收盘资金数据</div>
                  )}

                  {history.notFoundNames.length > 0 && (
                    <div className={styles.llmMeta}>未找到：{history.notFoundNames.join('、')}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {llmError && !llmLoading && (
            <div className={`${styles.result} ${styles.resultError}`}>
              <p className={styles.errorMsg}>{llmError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
