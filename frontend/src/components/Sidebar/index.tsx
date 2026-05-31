import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, Tooltip, Space, Typography, Segmented } from 'antd';
import {
  DeleteOutlined,
  PushpinOutlined,
  PushpinFilled,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useFavoritesStore } from '../../store/favoritesStore';
import StockSearch from '../StockSearch';
import FundSearch from '../FundSearch';
import type { Stock } from '../../types';
import styles from './Sidebar.module.css';

const { Text } = Typography;

const SECTION_OPTIONS = [
  { value: 'stock', label: '股票' },
  { value: 'fund', label: '基金' },
] as const;

export default function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { favorites, fetchFavorites, removeStock, pinStock, reorderStocks } =
    useFavoritesStore();

  const section = pathname.startsWith('/fund') ? 'fund' : 'stock';

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const stockFavorites = favorites.filter((f) => f.market !== 'FUND');
  const fundFavorites = favorites.filter((f) => f.market === 'FUND');

  const moveItem = (list: Stock[], index: number, direction: 'up' | 'down') => {
    const copy = [...list];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]];
    reorderStocks(copy.map((f) => f.id!));
  };

  const handleSectionChange = (val: string) => {
    if (val === 'stock') navigate('/stock');
    else navigate('/fund');
  };

  const renderItem = (stock: Stock, index: number, list: Stock[], urlFn: (s: Stock) => string) => (
    <div
      key={stock.id}
      className={`${styles.item} ${pathname === urlFn(stock) ? styles.selected : ''}`}
      onClick={() => navigate(urlFn(stock))}
    >
      <div className={styles.stockInfo}>
        <Text strong className={styles.name}>{stock.name}</Text>
        <Text type="secondary" className={styles.code}>
          {stock.code} · {stock.market === 'HK' ? '港股' : stock.market === 'FUND' ? '基金' : 'A股'}
        </Text>
      </div>
      <Space size={0} className={styles.actions} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={stock.pinned ? '取消置顶' : '置顶'}>
          <Button
            type="text"
            size="small"
            icon={stock.pinned ? <PushpinFilled /> : <PushpinOutlined />}
            onClick={() => pinStock(stock.id!, !stock.pinned)}
          />
        </Tooltip>
        <Tooltip title="上移">
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => moveItem(list, index, 'up')}
          />
        </Tooltip>
        <Tooltip title="下移">
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={index === list.length - 1}
            onClick={() => moveItem(list, index, 'down')}
          />
        </Tooltip>
        <Tooltip title="删除">
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => removeStock(stock.id!)}
          />
        </Tooltip>
      </Space>
    </div>
  );

  return (
    <div className={styles.sidebar}>
      <div className={styles.sectionSelect}>
        <Segmented
          value={section}
          options={SECTION_OPTIONS}
          onChange={(val) => handleSectionChange(val as string)}
          block
        />
      </div>

      <div className={styles.search}>
        {section === 'stock' ? <StockSearch size="middle" /> : <FundSearch size="middle" />}
      </div>

      {section === 'stock' && (
        <div>
          {stockFavorites.map((stock, index) =>
            renderItem(stock, index, stockFavorites, (s) => `/stock/${s.market}/${s.code}`),
          )}
        </div>
      )}

      {section === 'fund' && (
        <div>
          {fundFavorites.map((stock, index) =>
            renderItem(stock, index, fundFavorites, (s) => `/fund/${s.code}`),
          )}
        </div>
      )}
    </div>
  );
}
