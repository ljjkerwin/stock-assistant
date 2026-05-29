import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Typography, Descriptions, Spin, Tag } from 'antd';
import { fundApi } from '../../api/stock';
import NavChart from '../../components/NavChart';
import type { FundInfo } from '../../types';
import styles from './FundDetail.module.css';

export default function FundDetail() {
  const { code } = useParams<{ code: string }>();
  const [info, setInfo] = useState<FundInfo | null>(null);
  const [loading, setLoading] = useState(false);

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

  const dailyUp = info?.dailyChangePct != null && info.dailyChangePct > 0;
  const dailyDown = info?.dailyChangePct != null && info.dailyChangePct < 0;
  const dailyColor = dailyUp ? '#ef5350' : dailyDown ? '#26a69a' : undefined;

  const estUp = info?.estimatedChangePct != null && info.estimatedChangePct > 0;
  const estDown = info?.estimatedChangePct != null && info.estimatedChangePct < 0;
  const estColor = estUp ? '#ef5350' : estDown ? '#26a69a' : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {info?.name ?? code}
        </Typography.Title>
        <Tag color="purple" style={{ marginLeft: 8 }}>
          {code} · 基金
        </Tag>
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
            {info.estimatedNav != null && (
              <Descriptions.Item label="实时估值">
                <span style={{ fontWeight: 600 }}>{info.estimatedNav.toFixed(4)}</span>
              </Descriptions.Item>
            )}
            {info.estimatedChangePct != null && (
              <Descriptions.Item label="估值涨跌">
                <span style={{ color: estColor }}>
                  {`${estUp ? '+' : ''}${info.estimatedChangePct.toFixed(2)}%`}
                </span>
              </Descriptions.Item>
            )}
            {info.estimatedTime && (
              <Descriptions.Item label="估值时间">
                {info.estimatedTime}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Spin>

      <div className={styles.chart}>
        {code && <NavChart code={code} />}
      </div>
    </div>
  );
}
