import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LinkOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import KLineChart from '../../components/KLineChart';
import { darktradeApi } from '../../api/stock';
import type { DarkTradeSnapshot } from '../../types';
import styles from './DarkTradeDiscovery.module.css';

interface Props {
  code: string;
  name: string;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const POPUP_WIDTH = 920;
const POPUP_HEIGHT = 570;
const POPUP_GAP = 12;

function position(rect: DOMRect) {
  const margin = 8;
  let left = rect.right + POPUP_GAP;
  const top = rect.top + 20;

  // 始终优先放在标题右侧；空间不足时仅向左收拢到视窗边缘，不再回退到标题左侧覆盖鼠标。
  if (left + POPUP_WIDTH > window.innerWidth - margin) {
    left = Math.max(rect.right + POPUP_GAP, window.innerWidth - POPUP_WIDTH - margin);
  }

  return {
    left: Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - POPUP_WIDTH - margin)),
    top: Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - POPUP_HEIGHT - margin)),
  };
}

export default function DarkTradeTimesharePopup({
  code,
  name,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const [timeshareSnapshots, setTimeshareSnapshots] = useState<DarkTradeSnapshot[]>([]);
  const timeshareDateRef = useRef('');
  const { left, top } = position(anchorRect);

  useEffect(() => {
    setTimeshareSnapshots([]);
    timeshareDateRef.current = '';
  }, [code]);

  const handleTimeshareDate = (date: string) => {
    if (date === timeshareDateRef.current) return;
    timeshareDateRef.current = date;
    darktradeApi.getSnapshotsBatch([code], date).then((data) => {
      setTimeshareSnapshots(data[code] ?? []);
    });
  };

  return createPortal(
    <div
      className={styles.timesharePopup}
      style={{ left, top, width: POPUP_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.popupHeader}>
        <span>{name}</span>
        <span className={styles.popupMeta}>
          {code} · 分时与日线对照
          <Tooltip title="在新标签页打开详情">
            <a href={`/stock/A/${code}`} target="_blank" rel="noopener noreferrer">
              <LinkOutlined />
            </a>
          </Tooltip>
        </span>
      </div>
      <div className={styles.popupCharts}>
        <section className={styles.pricePanel}>
          <KLineChart
            market="A"
            code={code}
            period="timeshare"
            showPeriodTabs={false}
            showMacd={false}
            showDarkTrade
            darkTradeSnapshots={timeshareSnapshots}
            onDateResolved={handleTimeshareDate}
          />
        </section>
        <section className={styles.dailyPanel}>
          <KLineChart
            market="A"
            code={code}
            period="daily"
            showPeriodTabs={false}
            showMacd={false}
            showDarkTrade
            defaultZoomMultiplier={1.5}
          />
        </section>
      </div>
    </div>,
    document.body,
  );
}
