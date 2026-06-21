import { useEffect, useState, useRef } from 'react';
import { Upload, Button, Table, Typography, Space, Tag } from 'antd';
import { UploadOutlined, FileExcelOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import HoldingKlinePopup from '../../components/HoldingKlinePopup';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import styles from './StockListImport.module.css';

const { Text, Title } = Typography;

interface StockRow {
  _key: string;
  code: string;
  name: string;
  extras: string[];
}

interface ParsedFile {
  filename: string;
  codeHeader: string;
  nameHeader: string;
  extraHeaders: string[];
  numericExtraCols: boolean[];
  rows: StockRow[];
}

interface HoveredStock {
  code: string;
  name: string;
  market: 'A' | 'HK';
  rect: DOMRect;
}

function inferMarket(code: string): 'A' | 'HK' {
  return /^\d{6}$/.test(code.trim()) ? 'A' : 'HK';
}

function looksLikeCode(cell: string): boolean {
  return /^\d{4,6}$/.test(cell.trim());
}

function parseNumeric(v: string): number {
  const n = parseFloat(v.replace(/%$/, '').trim());
  return isNaN(n) ? -Infinity : n;
}

function isNumericCol(rows: StockRow[], idx: number): boolean {
  const vals = rows.map((r) => r.extras[idx] ?? '').filter((v) => v !== '');
  if (vals.length === 0) return false;
  const numCount = vals.filter((v) => !isNaN(parseFloat(v.replace(/%$/, '').trim()))).length;
  return numCount / vals.length >= 0.8;
}

function parseWorkbook(wb: XLSX.WorkBook, filename: string): ParsedFile {
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });

  if (raw.length === 0) {
    return { filename, codeHeader: '代码', nameHeader: '名称', extraHeaders: [], numericExtraCols: [], rows: [] };
  }

  const colCount = raw.reduce((m, r) => Math.max(m, r.length), 0);

  let dataStart = 0;
  let codeHeader = '代码';
  let nameHeader = '名称';
  let extraHeaders: string[];

  const firstCell = String(raw[0][0] ?? '').trim();
  if (!looksLikeCode(firstCell)) {
    const headerRow = raw[0].map((c) => String(c ?? '').trim());
    codeHeader = headerRow[0] || '代码';
    nameHeader = headerRow[1] || '名称';
    extraHeaders = headerRow.slice(2);
    dataStart = 1;
  } else {
    extraHeaders = Array.from({ length: Math.max(0, colCount - 2) }, (_, i) => `列${i + 3}`);
  }

  const rows: StockRow[] = raw
    .slice(dataStart)
    .filter((r) => r[0] != null && String(r[0]).trim() !== '')
    .map((r, idx) => ({
      _key: String(idx),
      code: String(r[0] ?? '').trim(),
      name: String(r[1] ?? '').trim(),
      extras: r.slice(2).map((c) => String(c ?? '').trim()),
    }));

  const numericExtraCols = extraHeaders.map((_, i) => isNumericCol(rows, i));

  return { filename, codeHeader, nameHeader, extraHeaders, numericExtraCols, rows };
}

export default function StockListImport() {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [hovered, setHovered] = useState<HoveredStock | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { itemsByList, fetchList, addToList } = useFavoritesStore();
  const { stockLists, fetchLists } = useWatchListStore();
  const defaultListId = stockLists.find((l) => l.isDefault)?.id ?? null;

  useEffect(() => {
    fetchLists('stock');
  }, [fetchLists]);

  useEffect(() => {
    if (defaultListId != null) fetchList(defaultListId);
  }, [defaultListId, fetchList]);

  const hoveredIsFavorited =
    hovered && defaultListId != null
      ? (itemsByList[defaultListId] ?? []).some(
          (f) => f.code === hovered.code && f.market === hovered.market,
        )
      : false;

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const wb = XLSX.read(data, { type: 'array' });
      setParsed(parseWorkbook(wb, file.name));
      setHovered(null);
    };
    reader.readAsArrayBuffer(file);
    return false;
  };

  const handleNameEnter = (row: StockRow, e: React.MouseEvent) => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    setHovered({
      code: row.code,
      name: row.name,
      market: inferMarket(row.code),
      rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
    });
  };

  const handleNameLeave = () => {
    leaveTimerRef.current = setTimeout(() => setHovered(null), 200);
  };

  const handlePopupEnter = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
  };

  const handlePopupLeave = () => {
    leaveTimerRef.current = setTimeout(() => setHovered(null), 200);
  };

  const handleAddFavorite = () => {
    if (!hovered || defaultListId == null) return;
    addToList(defaultListId, { code: hovered.code, market: hovered.market, name: hovered.name });
  };

  const columns = parsed
    ? [
        {
          title: parsed.codeHeader,
          dataIndex: 'code',
          width: 110,
          render: (code: string) => (
            <Text code style={{ fontSize: 13 }}>
              {code}
            </Text>
          ),
        },
        {
          title: parsed.nameHeader,
          dataIndex: 'name',
          width: 160,
          render: (name: string, record: StockRow) => (
            <span
              className={styles.nameCell}
              onMouseEnter={(e) => handleNameEnter(record, e)}
              onMouseLeave={handleNameLeave}
            >
              {name}
            </span>
          ),
        },
        ...parsed.extraHeaders.map((h, idx) => ({
          title: h || `列${idx + 3}`,
          key: `extra_${idx}`,
          ...(parsed.numericExtraCols[idx]
            ? {
                sorter: (a: StockRow, b: StockRow) =>
                  parseNumeric(a.extras[idx] ?? '') - parseNumeric(b.extras[idx] ?? ''),
              }
            : {}),
          render: (_: unknown, record: StockRow) => (
            <span className={styles.extraCell}>{record.extras[idx] ?? ''}</span>
          ),
        })),
      ]
    : [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Title level={4} style={{ margin: 0 }}>
          股票列表导入
        </Title>
        <Space>
          <Upload
            accept=".xlsx,.xls,.csv"
            showUploadList={false}
            beforeUpload={handleFile}
          >
            <Button icon={<UploadOutlined />} type="primary">
              导入文件
            </Button>
          </Upload>
        </Space>
      </div>

      {parsed && (
        <div className={styles.fileInfo}>
          <FileExcelOutlined className={styles.fileIcon} />
          <Text type="secondary" style={{ fontSize: 13 }}>
            {parsed.filename}
          </Text>
          <Tag color="blue" style={{ marginLeft: 8 }}>
            {parsed.rows.length} 条
          </Tag>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
            · 鼠标悬停名称查看 K 线
          </Text>
        </div>
      )}

      <div className={styles.tableWrap}>
        {parsed ? (
          <Table
            dataSource={parsed.rows}
            columns={columns}
            rowKey="_key"
            size="small"
            pagination={{ pageSize: 500, showSizeChanger: true, pageSizeOptions: ['100', '200', '500', '1000'] }}
            scroll={{ x: 'max-content' }}
            sticky
            locale={{ emptyText: '文件中未识别到有效股票数据' }}
          />
        ) : (
          <div className={styles.empty}>
            <UploadOutlined className={styles.emptyIcon} />
            <div className={styles.emptyTitle}>导入股票列表文件</div>
            <div className={styles.emptyDesc}>
              支持 Excel (.xlsx / .xls) 和 CSV 文件
              <br />
              第一列识别为股票代码，第二列识别为股票名称，其余列原样保留
            </div>
            <Upload
              accept=".xlsx,.xls,.csv"
              showUploadList={false}
              beforeUpload={handleFile}
            >
              <Button icon={<UploadOutlined />} type="primary" size="large" style={{ marginTop: 16 }}>
                选择文件
              </Button>
            </Upload>
          </div>
        )}
      </div>

      {hovered && (
        <HoldingKlinePopup
          code={hovered.code}
          name={hovered.name}
          market={hovered.market}
          anchorRect={hovered.rect}
          onMouseEnter={handlePopupEnter}
          onMouseLeave={handlePopupLeave}
          onAddFavorite={handleAddFavorite}
          isFavorited={hoveredIsFavorited}
        />
      )}
    </div>
  );
}
