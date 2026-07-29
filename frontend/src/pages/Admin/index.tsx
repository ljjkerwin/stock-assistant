import { useState } from 'react';
import { DatePicker, Button, Input, Spin } from 'antd';
import {
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { darktradeApi } from '../../api/stock';
import type { DarkTradeData } from '../../types';
import styles from './Admin.module.css';

interface FetchResult {
  date: string;
  total: number;
  written: number;
}

function formatCapital(value: number | null) {
  if (value == null) return '--';
  const divisor = Math.abs(value) >= 10_000_000 ? 100_000_000 : 10_000;
  const suffix = divisor === 100_000_000 ? 'y' : 'w';
  const digits = suffix === 'y' ? 2 : 0;
  return `${Number((value / divisor).toFixed(digits))}${suffix}`;
}

export default function Admin() {
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchDate, setSearchDate] = useState<Dayjs>(dayjs());
  const [stockName, setStockName] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<DarkTradeData | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

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
    setSearchResult(null);
    setSearchError(null);
    try {
      const data = await darktradeApi.getDailyResultByName(name, searchDate.format('YYYYMMDD'));
      if (data) {
        setSearchResult(data);
      } else {
        setSearchError('未找到该日期的资金数据，请确认股票名称或先采集该日期数据');
      }
    } catch (e: unknown) {
      setSearchError(e instanceof Error ? e.message : '查询失败，请稍后重试');
    } finally {
      setSearchLoading(false);
    }
  };

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

          {searchResult && !searchLoading && (
            <div className={`${styles.result} ${styles.resultSuccess} ${styles.capitalResult}`}>
              <p className={`${styles.resultTitle} ${styles.resultTitleSuccess}`}>
                <CheckCircleOutlined style={{ marginRight: 6 }} />
                {searchResult.name}（{searchResult.code}） · {searchDate.format('YYYY-MM-DD')}
              </p>
              <p className={styles.capitalValue}>
                {searchResult.displayName ?? searchResult.name}，暗{formatCapital(searchResult.darkCapital)}，明
                {formatCapital(searchResult.lightCapital)}
              </p>
            </div>
          )}

          {searchError && !searchLoading && (
            <div className={`${styles.result} ${styles.resultError}`}>
              <p className={styles.errorMsg}>{searchError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
